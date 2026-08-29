import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';

import { RealtimeFacade } from '../realtime/realtime.facade';
import { ActiveWorkspaceFacade, WorkspaceSummary } from './active-workspace.facade';
import { WorkspacePreferenceService } from './workspace-preference.service';

export type WorkspaceSelectionStatus =
  | 'loading'
  | 'selected'
  | 'selectionRequired'
  | 'unavailable';

export type WorkspaceSelectionSource = 'route' | 'preference' | 'single' | 'explicit';

export interface WorkspaceSelectionIdentity {
  readonly tenantId: string;
  readonly userId: string;
}

export interface WorkspaceSelectionSnapshot {
  readonly status: WorkspaceSelectionStatus;
  readonly workspaceId: string | null;
  readonly source: WorkspaceSelectionSource | null;
}

const INITIAL_SELECTION: WorkspaceSelectionSnapshot = {
  status: 'loading',
  workspaceId: null,
  source: null,
};

@Injectable({ providedIn: 'root' })
export class WorkspaceSelectionFacade {
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly preferences = inject(WorkspacePreferenceService);
  private readonly realtime = inject(RealtimeFacade);
  private readonly router = inject(Router, { optional: true });
  private readonly selectionState = signal<WorkspaceSelectionSnapshot>(INITIAL_SELECTION);
  private identity: WorkspaceSelectionIdentity | null = null;
  private authorizedWorkspaces = new Map<string, WorkspaceSummary>();
  /**
   * The last reconciled scope survives a temporary authorization recheck even
   * while its visible ActiveWorkspace projection is hidden. That lets an A→A
   * reauthorization preserve mounted route intent, while A→B or revoked A
   * still performs the full destructive Workspace boundary exactly once.
   */
  private selectedWorkspaceId: string | null = null;
  private selectionOperationGeneration = 0;
  private readonly transitionRevisionState = signal(0);

  readonly selection = this.selectionState.asReadonly();
  readonly transitionRevision = this.transitionRevisionState.asReadonly();

  beginLoading(identity: WorkspaceSelectionIdentity | null): void {
    if (!sameIdentity(this.identity, identity)) {
      this.updateIdentity(identity);
    }
    this.authorizedWorkspaces.clear();
    this.selectionState.set({
      status: identity ? 'loading' : 'unavailable',
      workspaceId: null,
      source: null,
    });
  }

  markAuthorizationPending(): void {
    this.selectionOperationGeneration++;
    this.authorizedWorkspaces.clear();
    // RealtimeFacade already cleared every protected projection before
    // advancing its authorization revision. Hide the header scope without
    // invoking a Workspace boundary that would destroy route subscription
    // intent needed by the following reauthorization/catch-up.
    this.activeWorkspace.clearWorkspace();
    this.selectionState.set({ status: 'loading', workspaceId: null, source: null });
  }

  reconcileAuthorizedWorkspaces(
    workspaces: readonly WorkspaceSummary[],
    identity: WorkspaceSelectionIdentity,
    routeWorkspaceId: string | null,
  ): WorkspaceSelectionSnapshot {
    this.updateIdentity(identity);
    this.authorizedWorkspaces = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

    if (routeWorkspaceId) {
      const routeWorkspace = this.authorizedWorkspaces.get(routeWorkspaceId) ?? null;
      if (routeWorkspace) {
        return this.activate(routeWorkspace, 'route');
      }

      // An explicit Workspace route is authoritative. If that Workspace is no
      // longer in the current server-authorized list, do not silently fall
      // through to a preference or sole remaining Workspace while the old
      // scoped component is still mounted.
      if (this.identity) {
        const preferredWorkspaceId = this.preferences.read(
          this.identity.tenantId,
          this.identity.userId,
        );
        if (preferredWorkspaceId === routeWorkspaceId) {
          this.preferences.clear(this.identity.tenantId, this.identity.userId);
        }
      }
      this.clearActiveWorkspace(true);
      const unavailable: WorkspaceSelectionSnapshot = {
        status: 'unavailable',
        workspaceId: null,
        source: null,
      };
      this.selectionState.set(unavailable);
      return unavailable;
    }

    const preferredWorkspaceId = this.preferences.read(identity.tenantId, identity.userId);
    if (preferredWorkspaceId) {
      const preferredWorkspace = this.authorizedWorkspaces.get(preferredWorkspaceId);
      if (preferredWorkspace) {
        return this.activate(preferredWorkspace, 'preference');
      }

      this.preferences.clear(identity.tenantId, identity.userId);
    }

    if (workspaces.length === 1) {
      return this.activate(workspaces[0], 'single');
    }

    const explicitWorkspace = this.selectedWorkspaceId
      ? this.authorizedWorkspaces.get(this.selectedWorkspaceId) ?? null
      : null;
    if (explicitWorkspace) {
      return this.activate(explicitWorkspace, 'explicit');
    }

    this.clearActiveWorkspace(true);
    const next: WorkspaceSelectionSnapshot = {
      status: workspaces.length > 1 ? 'selectionRequired' : 'unavailable',
      workspaceId: null,
      source: null,
    };
    this.selectionState.set(next);
    return next;
  }

  markUnavailable(discardPreference = false): void {
    if (discardPreference && this.identity) {
      this.preferences.clear(this.identity.tenantId, this.identity.userId);
    }

    this.authorizedWorkspaces.clear();
    this.clearActiveWorkspace(true);
    this.selectionState.set({ status: 'unavailable', workspaceId: null, source: null });
  }

  markTransientFailure(): void {
    this.authorizedWorkspaces.clear();
    this.selectionOperationGeneration++;
    // A network/5xx/schema failure is not proof that the mounted scope was
    // revoked. Disable new selection until retry without destroying already
    // server-authorized route intent or protected projections.
    this.selectionState.set({ status: 'unavailable', workspaceId: null, source: null });
  }

  async selectWorkspace(
    workspaceId: string,
    isOperationCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    const workspace = this.authorizedWorkspaces.get(workspaceId);
    const identity = this.identity;
    if (!workspace || !identity || !canCommitSelection(isOperationCurrent)) {
      return false;
    }
    const operationGeneration = ++this.selectionOperationGeneration;

    const currentWorkspaceId =
      this.selectedWorkspaceId ?? this.activeWorkspace.activeWorkspace()?.id ?? null;
    if (
      currentWorkspaceId !== workspace.id &&
      this.router &&
      isWorkspaceSpecificRoute(this.router.url)
    ) {
      try {
        const navigated = await this.router.navigateByUrl('/workspaces');
        if (!navigated) {
          return false;
        }
      } catch {
        return false;
      }
    }

    const currentWorkspace = this.authorizedWorkspaces.get(workspaceId);
    if (
      operationGeneration !== this.selectionOperationGeneration ||
      !canCommitSelection(isOperationCurrent) ||
      this.identity?.tenantId !== identity.tenantId ||
      this.identity.userId !== identity.userId ||
      !currentWorkspace
    ) {
      return false;
    }

    // Navigation can await guards while an authorization refresh replaces the
    // dashboard projection. Activate only the latest still-authorized card.
    this.activate(currentWorkspace, 'explicit');
    return true;
  }

  /** Route guards may validate this map, but only NavigationEnd commits scope. */
  isWorkspaceAuthorized(workspaceId: string): boolean {
    return this.identity !== null && this.authorizedWorkspaces.has(workspaceId);
  }

  private activate(
    workspace: WorkspaceSummary,
    source: WorkspaceSelectionSource,
  ): WorkspaceSelectionSnapshot {
    const currentWorkspaceId =
      this.selectedWorkspaceId ?? this.activeWorkspace.activeWorkspace()?.id ?? null;
    const switchedWorkspace = currentWorkspaceId !== null && currentWorkspaceId !== workspace.id;
    if (switchedWorkspace) {
      this.realtime.clearForWorkspaceBoundary();
      this.selectionOperationGeneration++;
      this.transitionRevisionState.update((revision) => revision + 1);
    }
    this.selectedWorkspaceId = workspace.id;
    // Refreshing the authorized card may change its display label without
    // changing the opaque ID. ActiveWorkspace must still receive that newer
    // backend projection.
    this.activeWorkspace.setActiveWorkspace(workspace);

    if (this.identity) {
      this.preferences.write(this.identity.tenantId, this.identity.userId, workspace.id);
    }

    const next: WorkspaceSelectionSnapshot = {
      status: 'selected',
      workspaceId: workspace.id,
      source,
    };
    this.selectionState.set(next);
    if (switchedWorkspace) {
      // The replacement scope is now committed. Rehydrate protected feature
      // projections from their own server-authorized HTTP reads, rather than
      // retaining the scope that was cleared above. This also covers the
      // HTTP-only rollout where no SignalR reconnect will run catch-ups.
      void this.realtime.runAuthoritativeHttpCatchUps();
    }
    return next;
  }

  private updateIdentity(identity: WorkspaceSelectionIdentity | null): void {
    if (sameIdentity(this.identity, identity)) {
      return;
    }

    this.authorizedWorkspaces.clear();
    this.clearActiveWorkspace(true);
    this.identity = identity;
  }

  private clearActiveWorkspace(clearBoundary = false): void {
    const hasActiveWorkspace = this.activeWorkspace.activeWorkspace() !== null;
    const hadSelectedScope = this.selectedWorkspaceId !== null || hasActiveWorkspace;
    if (clearBoundary && hadSelectedScope) {
      this.realtime.clearForWorkspaceBoundary();
      this.selectionOperationGeneration++;
      this.transitionRevisionState.update((revision) => revision + 1);
      // Realtime owns the production-wide clear registry, but selection also
      // owns this canonical pointer and must not rely on a test/alternate
      // transport implementation to clear it as a side effect.
      this.activeWorkspace.clearWorkspace();
    } else if (hasActiveWorkspace) {
      this.activeWorkspace.clearWorkspace();
    }
    this.selectedWorkspaceId = null;
  }
}

export function workspaceIdFromRoute(url: string): string | null {
  const path = routePath(url);
  const match = /^\/workspaces\/([^/]+)(?:\/|$)/u.exec(path);
  if (!match) {
    return null;
  }

  try {
    const workspaceId = decodeURIComponent(match[1]);
    return workspaceId.length > 0 ? workspaceId : null;
  } catch {
    return null;
  }
}

export function isWorkspaceSpecificRoute(url: string): boolean {
  const path = routePath(url);
  return (
    /^\/workspaces\/[^/]+(?:\/|$)/u.test(path) ||
    /^\/projects(?:\/|$)/u.test(path) ||
    /^\/tasks(?:\/|$)/u.test(path) ||
    /^\/files(?:\/|$)/u.test(path) ||
    /^\/artifacts(?:\/|$)/u.test(path) ||
    /^\/messages(?:\/|$)/u.test(path) ||
    /^\/conversations(?:\/|$)/u.test(path) ||
    /^\/dm(?:\/|$)/u.test(path)
  );
}

function routePath(url: string): string {
  return url.split(/[?#]/u, 1)[0];
}

function sameIdentity(
  left: WorkspaceSelectionIdentity | null,
  right: WorkspaceSelectionIdentity | null,
): boolean {
  return left?.tenantId === right?.tenantId && left?.userId === right?.userId;
}

function canCommitSelection(isOperationCurrent: () => boolean): boolean {
  try {
    return isOperationCurrent();
  } catch {
    return false;
  }
}
