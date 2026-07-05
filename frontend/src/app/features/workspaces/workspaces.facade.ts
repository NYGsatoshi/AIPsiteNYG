import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import {
  WorkspaceCardViewModel,
  WorkspaceDashboardViewModel,
  WorkspaceRoleLabel,
} from './workspaces.types';

export const AIP_WORKSPACES_DASHBOARD_MOCK = new InjectionToken<WorkspaceDashboardViewModel>(
  'AIP_WORKSPACES_DASHBOARD_MOCK',
);

interface WorkspaceListItemDto {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly status?: unknown;
  readonly updatedAt?: unknown;
  readonly createdAt?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class WorkspacesFacade {
  private readonly http = inject(HttpClient);
  private readonly mockDashboard = inject(AIP_WORKSPACES_DASHBOARD_MOCK, { optional: true });
  private readonly dashboardState = signal<WorkspaceDashboardViewModel>(
    this.mockDashboard ?? this.emptyDashboard('loading'),
  );

  readonly dashboard = this.dashboardState.asReadonly();

  constructor() {
    if (!this.mockDashboard) {
      this.loadWorkspaces();
    }
  }

  private loadWorkspaces(): void {
    this.http
      .get<readonly WorkspaceListItemDto[]>('/api/workspaces', { withCredentials: true })
      .subscribe({
        next: (workspaces) => {
          const cards = workspaces.map((workspace) => this.toWorkspaceCard(workspace));
          this.dashboardState.set({
            ...this.emptyDashboard(cards.length === 0 ? 'noWorkspaceAccess' : 'ready'),
            workspaces: cards,
            message:
              cards.length === 0 ? 'No authorized workspaces were returned by the API.' : undefined,
          });
        },
        error: (error: { status?: number }) => {
          const status = error.status === 401 ? 'permissionDenied' : 'error';
          this.dashboardState.set({
            ...this.emptyDashboard(status),
            message:
              status === 'permissionDenied'
                ? 'Authentication is required.'
                : 'Workspace API request failed.',
          });
        },
      });
  }

  private emptyDashboard(
    status: WorkspaceDashboardViewModel['status'],
  ): WorkspaceDashboardViewModel {
    return {
      status,
      title: 'Workspaces',
      subtitle: 'Live API data',
      workspaces: [],
      pageCapabilities: [],
      partialSummaryUnavailable: true,
    };
  }

  private toWorkspaceCard(workspace: WorkspaceListItemDto): WorkspaceCardViewModel {
    const updatedAt = stringValue(workspace.updatedAt) ?? stringValue(workspace.createdAt);

    return {
      id: stringValue(workspace.id) ?? '',
      displayName: stringValue(workspace.name) ?? 'Workspace',
      roleLabel: this.roleLabel(),
      unreadAnnouncementCount: null,
      unreadConversationCount: null,
      activeProjectCount: null,
      lastUpdatedLabel: updatedAt ? new Date(updatedAt).toLocaleDateString() : null,
      availability: {
        unreadAnnouncements: false,
        unreadConversations: false,
        activeProjects: false,
        lastUpdated: updatedAt !== undefined,
      },
      capabilities: ['openWorkspace', 'openMembers', 'openProjects'],
    };
  }

  private roleLabel(): WorkspaceRoleLabel {
    return '繝｡繝ｳ繝舌・' as WorkspaceRoleLabel;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
