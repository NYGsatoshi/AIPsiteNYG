export type WorkspaceRoleLabel = '管理者' | '先生' | 'メンバー' | '閲覧のみ';

export type WorkspaceActionCapability = 'openWorkspace' | 'openMembers' | 'openProjects';

export type WorkspacePageCapability = 'createWorkspace';

export type WorkspaceDashboardStatus = 'ready' | 'loading' | 'error' | 'permissionDenied' | 'noWorkspaceAccess';

export interface WorkspaceSummaryAvailability {
  readonly unreadAnnouncements: boolean;
  readonly unreadConversations: boolean;
  readonly activeProjects: boolean;
  readonly lastUpdated: boolean;
}

export interface WorkspaceCardViewModel {
  readonly id: string;
  readonly displayName: string;
  readonly roleLabel: WorkspaceRoleLabel;
  readonly unreadAnnouncementCount: number | null;
  readonly unreadConversationCount: number | null;
  readonly activeProjectCount: number | null;
  readonly lastUpdatedLabel: string | null;
  readonly availability: WorkspaceSummaryAvailability;
  readonly capabilities: readonly WorkspaceActionCapability[];
}

export interface WorkspaceDashboardViewModel {
  readonly status: WorkspaceDashboardStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly workspaces: readonly WorkspaceCardViewModel[];
  readonly pageCapabilities: readonly WorkspacePageCapability[];
  readonly partialSummaryUnavailable: boolean;
  readonly message?: string;
}
