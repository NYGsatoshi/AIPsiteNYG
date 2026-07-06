import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
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
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly authSession = inject(AuthSessionFacade);
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

  loadWorkspaces(): void {
    this.http
      .get<readonly WorkspaceListItemDto[]>('/api/workspaces', { withCredentials: true })
      .subscribe({
        next: (workspaces) => this.applyWorkspaceResponse(workspaces),
        error: (error: unknown) => this.applyWorkspaceError(error),
      });
  }

  private applyWorkspaceResponse(workspaces: readonly WorkspaceListItemDto[]): void {
    const cards = workspaces
      .map((workspace) => this.toWorkspaceCard(workspace))
      .filter((workspace) => workspace.id.length > 0);

    this.activeWorkspace.setActiveWorkspace(
      cards[0] ? { id: cards[0].id, label: cards[0].displayName } : null,
    );

    if (cards.length === 0) {
      this.dashboardState.set({
        ...this.emptyDashboard('noWorkspaceAccess'),
        message: this.emptyWorkspaceMessage(),
      });
      return;
    }

    this.dashboardState.set({
      ...this.emptyDashboard('ready'),
      workspaces: cards,
      partialSummaryUnavailable: true,
      message: '一部の集計情報はまだAPI未実装です。',
    });
  }

  private applyWorkspaceError(error: unknown): void {
    this.activeWorkspace.clearWorkspace();
    const httpError = error instanceof HttpErrorResponse ? error : null;
    const status = httpError?.status;
    const permissionDenied = status === 401 || status === 403;

    this.dashboardState.set({
      ...this.emptyDashboard(permissionDenied ? 'permissionDenied' : 'error'),
      message: workspaceErrorMessage(status),
    });
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
      partialSummaryUnavailable: false,
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
      lastUpdatedLabel: updatedAt ? new Date(updatedAt).toLocaleDateString('ja-JP') : null,
      availability: {
        unreadAnnouncements: false,
        unreadConversations: false,
        activeProjects: false,
        lastUpdated: updatedAt !== undefined,
      },
      capabilities: ['openMembers', 'openProjects'],
    };
  }

  private roleLabel(): WorkspaceRoleLabel {
    return 'メンバー';
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
