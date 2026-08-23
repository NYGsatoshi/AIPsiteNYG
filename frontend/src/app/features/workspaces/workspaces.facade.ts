import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
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
  private readonly http = inject(HttpClient);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly authSession = inject(AuthSessionFacade);
  private readonly mockDashboard = inject(AIP_WORKSPACES_DASHBOARD_MOCK, { optional: true });
  private readonly dashboardState = signal<WorkspaceDashboardViewModel>(
    this.mockDashboard ?? this.emptyDashboard('loading'),
  );
  private pageCapabilities: readonly WorkspacePageCapability[] = [];

  readonly dashboard = this.dashboardState.asReadonly();

  constructor() {
    if (!this.mockDashboard) {
      this.loadWorkspaces();
    }
  }

  loadWorkspaces(): void {
    this.pageCapabilities = [];
    this.dashboardState.set(this.emptyDashboard('loading'));
    this.loadCapabilities();

    this.http.get<unknown>('/api/workspaces', { withCredentials: true }).subscribe({
      next: (workspaces) => this.applyWorkspaceResponse(workspaces),
      error: (error: unknown) => this.applyWorkspaceError(error),
    });
  }

  private loadCapabilities(): void {
    this.http
      .get<WorkspaceCapabilitiesEnvelopeDto>('/api/workspaces/capabilities', {
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          this.pageCapabilities = mapWorkspacePageCapabilities(response);
          this.applyPageCapabilities();
        },
        error: () => {
          this.pageCapabilities = [];
          this.applyPageCapabilities();
        },
      });
  }

  private applyWorkspaceResponse(response: unknown): void {
    let cards: readonly WorkspaceCardViewModel[];
    try {
      cards = mapWorkspaceDashboardResponse(response);
    } catch {
      this.activeWorkspace.clearWorkspace();
      this.dashboardState.set({
        ...this.emptyDashboard('error'),
        message: 'Workspace APIの応答形式が正しくありません。',
      });
      return;
    }

    this.activeWorkspace.setActiveWorkspace(
      cards[0] ? { id: cards[0].id, label: cards[0].displayName } : null,
    );

    if (cards.length === 0) {
      this.dashboardState.set({
        ...this.emptyDashboard('noWorkspaceAccess'),
        pageCapabilities: this.pageCapabilities,
        message: this.emptyWorkspaceMessage(),
      });
      return;
    }

    this.dashboardState.set({
      ...this.emptyDashboard('ready'),
      workspaces: cards,
      pageCapabilities: this.pageCapabilities,
    });
  }

  private applyWorkspaceError(error: unknown): void {
    this.activeWorkspace.clearWorkspace();
    const status = normalizeApiError(error).httpStatus;
    const permissionDenied = status === 401 || status === 403;

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
