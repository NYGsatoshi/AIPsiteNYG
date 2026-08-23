export type WorkspaceMembershipRole = 'Owner' | 'Admin' | 'Adviser' | 'Member' | 'ReadOnly';

export type WorkspaceDashboardAccessSource = 'WorkspaceMembership' | 'SystemAdmin';

export type WorkspaceRoleLabel =
  '管理者' | '先生' | 'メンバー' | '閲覧のみ' | 'システム管理者アクセス' | '役割情報なし';

export type WorkspaceActionCapability = 'openWorkspace' | 'openMembers' | 'openProjects';

export type WorkspacePageCapability = 'createWorkspace';

export type WorkspaceDashboardStatus =
  'ready' | 'loading' | 'error' | 'permissionDenied' | 'noWorkspaceAccess';

export interface WorkspaceSummaryAvailability {
  readonly unreadAnnouncements: boolean;
  readonly unreadConversations: boolean;
  readonly activeProjects: boolean;
  readonly lastUpdated: boolean;
}

export interface WorkspaceCardViewModel {
  readonly id: string;
  readonly displayName: string;
  readonly currentUserRole: WorkspaceMembershipRole | null;
  readonly accessSource: WorkspaceDashboardAccessSource | null;
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
  readonly message?: string;
}
