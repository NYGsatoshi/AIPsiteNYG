import { HttpClient } from '@angular/common/http';
import { DestroyRef, effect, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import {
  WorkspaceSelectionFacade,
  WorkspaceSelectionIdentity,
  workspaceIdFromRoute,
} from '../../core/workspace/workspace-selection.facade';
import {
  mapWorkspaceDashboardResponse,
  mapWorkspacePageCapabilities,
  WorkspaceCapabilitiesEnvelopeDto,
} from './workspaces.api';
import {
  WorkspaceCardViewModel,
  WorkspaceDashboardViewModel,
  WorkspacePageCapability,
} from './workspaces.types';

export const AIP_WORKSPACES_DASHBOARD_MOCK = new InjectionToken<WorkspaceDashboardViewModel>(
  'AIP_WORKSPACES_DASHBOARD_MOCK',
);

@Injectable({
  providedIn: 'root',
})
export class WorkspacesFacade {
  private readonly http = inject(HttpClient, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly selection = inject(WorkspaceSelectionFacade);
  private readonly authSession = inject(AuthSessionFacade);
  private readonly realtime = inject(RealtimeFacade);
  private readonly mockDashboard = inject(AIP_WORKSPACES_DASHBOARD_MOCK, { optional: true });
  private readonly dashboardState = signal<WorkspaceDashboardViewModel>(
    this.mockDashboard ?? this.emptyDashboard('loading'),
  );
  private pageCapabilities: readonly WorkspacePageCapability[] = [];
  private loadGeneration = 0;
  private observedIdentityKey: string | null;
  private observedAuthorizationRevision: number;
  private reloadStartedAuthorizationRevision: number;
  private authorizationRecheckPending = false;
  private httpFallbackRecoveryGeneration: number | null = null;
  private workspaceListRequest: Subscription | null = null;
  private workspaceListCompletion: (() => void) | null = null;
  private workspaceListInFlight: Promise<void> | null = null;

  readonly dashboard = this.dashboardState.asReadonly();

  constructor() {
    const initialIdentity = this.currentIdentity();
    this.observedIdentityKey = identityKey(initialIdentity);
    this.observedAuthorizationRevision = this.realtime.authorizationRevision();
    this.reloadStartedAuthorizationRevision = this.observedAuthorizationRevision;

    if (this.mockDashboard) {
      this.reconcileSelection(this.mockDashboard.workspaces, initialIdentity);
      return;
    }

    this.initializeForIdentity(initialIdentity);

    const unregisterCatchUp = this.realtime.registerCatchUp(
      'workspaces-dashboard',
      () => this.reloadAfterAuthorizationCatchUp(),
    );
    this.destroyRef.onDestroy(unregisterCatchUp);

    effect(() => {
      const identity = this.currentIdentity();
      const nextIdentityKey = identityKey(identity);
      if (nextIdentityKey === this.observedIdentityKey) {
        return;
      }

      this.observedIdentityKey = nextIdentityKey;
      this.initializeForIdentity(identity);
    });

    effect(() => {
      const authorizationRevision = this.realtime.authorizationRevision();
      const state = this.realtime.connectionState();
      if (authorizationRevision !== this.observedAuthorizationRevision) {
        this.observedAuthorizationRevision = authorizationRevision;
        if (authorizationRevision !== this.reloadStartedAuthorizationRevision) {
          this.authorizationRecheckPending = true;
          this.invalidateForAuthorizationRecheck();
        }
      }

      if (state === 'Degraded' && this.authorizationRecheckPending) {
        // SignalR is an enhancement. If reauthorization transport cannot
        // recover, the current cookie-authenticated HTTP list still owns the
        // authorization decision and must restore (or deny) the shell scope.
        void this.loadWorkspaces(true);
      }
    });

    this.router?.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.reconcileCurrentRoute(event.urlAfterRedirects));
  }

  loadWorkspaces(recoverProtectedState = false): Promise<void> {
    this.cancelWorkspaceListRequest();
    const authorizationRevision = this.realtime.authorizationRevision();
    this.observedAuthorizationRevision = authorizationRevision;
    this.reloadStartedAuthorizationRevision = authorizationRevision;
    this.authorizationRecheckPending = false;

    const identity = this.currentIdentity();
    if (!identity || !this.http) {
      this.loadGeneration += 1;
      this.httpFallbackRecoveryGeneration = null;
      this.pageCapabilities = [];
      this.selection.beginLoading(null);
      this.dashboardState.set(this.emptyDashboard('error'));
      return Promise.resolve();
    }

    const generation = ++this.loadGeneration;
    this.httpFallbackRecoveryGeneration = recoverProtectedState ? generation : null;
    this.pageCapabilities = [];
    this.selection.beginLoading(identity);
    this.dashboardState.set(this.emptyDashboard('loading'));
    this.loadCapabilities(generation);

    const completionPromise = new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      this.workspaceListCompletion = settle;
      const request = this.http?.get<unknown>('/api/workspaces', { withCredentials: true }).subscribe({
        next: (workspaces) => this.applyWorkspaceResponse(workspaces, identity, generation),
        error: (error: unknown) => {
          this.applyWorkspaceError(error, generation);
          settle();
        },
        complete: settle,
      });
      this.workspaceListRequest = request ?? null;
      request?.add(() => {
        if (this.workspaceListRequest === request) {
          this.workspaceListRequest = null;
        }
        if (this.workspaceListCompletion === settle) {
          this.workspaceListCompletion = null;
        }
        settle();
      });
    });
    this.workspaceListInFlight = completionPromise;
    void completionPromise.finally(() => {
      if (this.workspaceListInFlight === completionPromise) {
        this.workspaceListInFlight = null;
      }
    });
    return completionPromise;
  }

  private initializeForIdentity(identity: WorkspaceSelectionIdentity | null): void {
    if (!identity) {
      this.loadGeneration += 1;
      this.cancelWorkspaceListRequest();
      this.pageCapabilities = [];
      this.selection.beginLoading(null);
      this.dashboardState.set(this.emptyDashboard('loading'));
      return;
    }

    void this.loadWorkspaces();
  }

  private invalidateForAuthorizationRecheck(): void {
    this.loadGeneration += 1;
    this.cancelWorkspaceListRequest();
    this.pageCapabilities = [];
    this.selection.markAuthorizationPending();
    this.dashboardState.set(this.emptyDashboard('loading'));
  }

  private cancelWorkspaceListRequest(): void {
    const request = this.workspaceListRequest;
    const completion = this.workspaceListCompletion;
    this.workspaceListRequest = null;
    this.workspaceListCompletion = null;
    this.workspaceListInFlight = null;
    request?.unsubscribe();
    completion?.();
  }

  private reloadAfterAuthorizationCatchUp(): Promise<void> | void {
    const authorizationRevision = this.realtime.authorizationRevision();
    if (authorizationRevision === this.reloadStartedAuthorizationRevision) {
      return this.workspaceListInFlight ?? undefined;
    }

    // A fast reconnect can reach catch-up before Angular has scheduled the
    // authorization-revision effect. Invalidate synchronously here as well so
    // no stale authorized card is visible while its HTTP replacement loads.
    if (authorizationRevision !== this.observedAuthorizationRevision) {
      this.observedAuthorizationRevision = authorizationRevision;
      this.authorizationRecheckPending = true;
      this.invalidateForAuthorizationRecheck();
    }

    return this.loadWorkspaces();
  }

  private loadCapabilities(generation: number): void {
    this.http
      ?.get<WorkspaceCapabilitiesEnvelopeDto>('/api/workspaces/capabilities', {
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          if (!this.isCurrentGeneration(generation)) {
            return;
          }

          this.pageCapabilities = mapWorkspacePageCapabilities(response);
          this.applyPageCapabilities();
        },
        error: () => {
          if (!this.isCurrentGeneration(generation)) {
            return;
          }

          this.pageCapabilities = [];
          this.applyPageCapabilities();
        },
      });
  }

  private applyWorkspaceResponse(
    response: unknown,
    identity: WorkspaceSelectionIdentity,
    generation: number,
  ): void {
    if (!this.isCurrentGeneration(generation) || !sameIdentity(identity, this.currentIdentity())) {
      return;
    }

    let cards: readonly WorkspaceCardViewModel[];
    try {
      cards = mapWorkspaceDashboardResponse(response);
    } catch {
      this.selection.markTransientFailure();
      this.dashboardState.set({
        ...this.emptyDashboard('error'),
        message: 'Workspace APIの応答形式が正しくありません。',
      });
      if (this.httpFallbackRecoveryGeneration === generation) {
        this.httpFallbackRecoveryGeneration = null;
      }
      return;
    }

    this.reconcileSelection(cards, identity);

    if (cards.length === 0) {
      this.dashboardState.set({
        ...this.emptyDashboard('noWorkspaceAccess'),
        pageCapabilities: this.pageCapabilities,
        message: this.emptyWorkspaceMessage(),
      });
      this.completeHttpFallbackRecovery(generation);
      return;
    }

    this.dashboardState.set({
      ...this.emptyDashboard('ready'),
      workspaces: cards,
      pageCapabilities: this.pageCapabilities,
    });
    this.completeHttpFallbackRecovery(generation);
  }

  private applyWorkspaceError(error: unknown, generation: number): void {
    if (!this.isCurrentGeneration(generation)) {
      return;
    }

    const status = normalizeApiError(error).httpStatus;
    const permissionDenied = status === 401 || status === 403;
    if (permissionDenied) {
      this.selection.markUnavailable(true);
    } else {
      this.selection.markTransientFailure();
    }
    if (this.httpFallbackRecoveryGeneration === generation) {
      this.httpFallbackRecoveryGeneration = null;
    }

    this.dashboardState.set({
      ...this.emptyDashboard(permissionDenied ? 'permissionDenied' : 'error'),
      message: workspaceErrorMessage(status),
    });
  }

  private applyPageCapabilities(): void {
    const status = this.dashboardState().status;
    if (status !== 'ready' && status !== 'noWorkspaceAccess') {
      return;
    }

    this.dashboardState.update((dashboard) => ({
      ...dashboard,
      pageCapabilities: this.pageCapabilities,
    }));
  }

  private completeHttpFallbackRecovery(generation: number): void {
    if (this.httpFallbackRecoveryGeneration !== generation) {
      return;
    }

    this.httpFallbackRecoveryGeneration = null;
    void this.realtime.runAuthoritativeHttpCatchUps();
  }

  private reconcileCurrentRoute(url = this.router?.url ?? ''): void {
    const identity = this.currentIdentity();
    const dashboard = this.dashboardState();
    if (!identity || dashboard.status !== 'ready') {
      return;
    }

    this.reconcileSelection(dashboard.workspaces, identity, url);
  }

  private reconcileSelection(
    cards: readonly WorkspaceCardViewModel[],
    identity: WorkspaceSelectionIdentity | null,
    routeUrl = this.router?.url ?? '',
  ): void {
    if (!identity) {
      this.selection.markUnavailable();
      return;
    }

    const routeWorkspaceId = workspaceIdFromRoute(routeUrl);
    this.selection.reconcileAuthorizedWorkspaces(
      cards.map((card) => ({ id: card.id, label: card.displayName })),
      identity,
      routeWorkspaceId,
    );
    if (routeWorkspaceId && !cards.some((card) => card.id === routeWorkspaceId)) {
      this.navigateRevokedRouteToNeutral(routeWorkspaceId);
    }
  }

  private navigateRevokedRouteToNeutral(revokedWorkspaceId: string): void {
    if (!this.router || workspaceIdFromRoute(this.router.url) !== revokedWorkspaceId) {
      return;
    }

    // The old scoped projection was cleared before this navigation. A guard
    // cancellation therefore remains fail closed instead of mounting the
    // revoked route under an unrelated sole/preferred Workspace.
    void this.router.navigateByUrl('/workspaces').catch(() => undefined);
  }

  private currentIdentity(): WorkspaceSelectionIdentity | null {
    const session = this.authSession.session();
    if (!session.isAuthenticated || !session.currentTenant || !session.currentUser) {
      return null;
    }

    return {
      tenantId: session.currentTenant.tenantId,
      userId: session.currentUser.userId,
    };
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.loadGeneration;
  }

  private emptyWorkspaceMessage(): string {
    const capabilities = this.authSession.session().capabilities;
    if (capabilities.includes('admin:access')) {
      return 'Workspaceがまだ作成されていません。起動時seedまたは管理画面からDefault Workspaceを作成してください。';
    }

    return 'Workspaceに所属していません。管理者に招待を依頼してください。';
  }

  private emptyDashboard(
    status: WorkspaceDashboardViewModel['status'],
  ): WorkspaceDashboardViewModel {
    return {
      status,
      title: 'Workspaces',
      subtitle: '参加中のWorkspace',
      workspaces: [],
      pageCapabilities: [],
    };
  }
}

function identityKey(identity: WorkspaceSelectionIdentity | null): string | null {
  return identity ? `${identity.tenantId}\u0000${identity.userId}` : null;
}

function sameIdentity(
  left: WorkspaceSelectionIdentity | null,
  right: WorkspaceSelectionIdentity | null,
): boolean {
  return left?.tenantId === right?.tenantId && left?.userId === right?.userId;
}

function workspaceErrorMessage(status: number | undefined): string {
  if (status === 0) {
    return 'ネットワークエラーまたはAPIに接続できません。';
  }

  if (status === 401) {
    return '未ログインまたは認証cookieが無効です。再ログインしてください。';
  }

  if (status === 403) {
    return 'Workspaceを表示する権限がありません。';
  }

  if (status === 404) {
    return 'Workspace APIが見つかりません。バックエンドのルートを確認してください。';
  }

  if (status !== undefined && status >= 500) {
    return 'Workspace APIでサーバーエラーが発生しました。';
  }

  return 'Workspaceを取得できません。';
}
