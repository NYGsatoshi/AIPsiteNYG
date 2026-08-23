import { WorkspaceCardViewModel, WorkspaceDashboardViewModel } from './workspaces.types';

const available = {
  unreadAnnouncements: true,
  unreadConversations: true,
  activeProjects: true,
  lastUpdated: true,
} as const;

export const OWNER_WORKSPACE: WorkspaceCardViewModel = {
  id: 'sample-workspace-owner',
  displayName: 'サンプル共同ワークスペースA',
  currentUserRole: 'Owner',
  accessSource: 'WorkspaceMembership',
  roleLabel: '管理者',
  unreadAnnouncementCount: 3,
  unreadConversationCount: 2,
  activeProjectCount: 5,
  lastUpdatedLabel: '今日 09:40',
  availability: available,
  capabilities: ['openWorkspace', 'openMembers', 'openProjects'],
};

export const ADMIN_WORKSPACE: WorkspaceCardViewModel = {
  id: 'sample-workspace-admin',
  displayName: '管理運用ワークスペースB',
  currentUserRole: 'Admin',
  accessSource: 'WorkspaceMembership',
  roleLabel: '管理者',
  unreadAnnouncementCount: 0,
  unreadConversationCount: 4,
  activeProjectCount: 2,
  lastUpdatedLabel: '昨日 16:15',
  availability: available,
  capabilities: ['openWorkspace', 'openMembers', 'openProjects'],
};

export const ADVISER_WORKSPACE: WorkspaceCardViewModel = {
  id: 'sample-workspace-adviser',
  displayName: '教材準備ワークスペースC',
  currentUserRole: 'Adviser',
  accessSource: 'WorkspaceMembership',
  roleLabel: '先生',
  unreadAnnouncementCount: 1,
  unreadConversationCount: 0,
  activeProjectCount: 3,
  lastUpdatedLabel: '6月30日',
  availability: available,
  capabilities: ['openWorkspace', 'openProjects'],
};

export const MEMBER_WORKSPACE: WorkspaceCardViewModel = {
  id: 'sample-workspace-member',
  displayName: 'メンバー共有ワークスペースD',
  currentUserRole: 'Member',
  accessSource: 'WorkspaceMembership',
  roleLabel: 'メンバー',
  unreadAnnouncementCount: 2,
  unreadConversationCount: 1,
  activeProjectCount: 0,
  lastUpdatedLabel: '7月1日',
  availability: available,
  capabilities: ['openWorkspace', 'openMembers', 'openProjects'],
};

export const READ_ONLY_WORKSPACE: WorkspaceCardViewModel = {
  id: 'sample-workspace-read-only',
  displayName: '確認用ワークスペースE',
  currentUserRole: 'ReadOnly',
  accessSource: 'WorkspaceMembership',
  roleLabel: '閲覧のみ',
  unreadAnnouncementCount: 0,
  unreadConversationCount: 0,
  activeProjectCount: 0,
  lastUpdatedLabel: '7月2日',
  availability: available,
  capabilities: ['openWorkspace'],
};

export const SYSTEM_ADMIN_WORKSPACE: WorkspaceCardViewModel = {
  id: 'sample-workspace-system-admin',
  displayName: 'システム管理対象ワークスペースF',
  currentUserRole: null,
  accessSource: 'SystemAdmin',
  roleLabel: 'システム管理者アクセス',
  unreadAnnouncementCount: 6,
  unreadConversationCount: 3,
  activeProjectCount: 4,
  lastUpdatedLabel: '7月3日',
  availability: available,
  capabilities: ['openWorkspace', 'openMembers', 'openProjects'],
};

export const DEFAULT_WORKSPACES: readonly WorkspaceCardViewModel[] = [
  OWNER_WORKSPACE,
  ADMIN_WORKSPACE,
  ADVISER_WORKSPACE,
  MEMBER_WORKSPACE,
  READ_ONLY_WORKSPACE,
  SYSTEM_ADMIN_WORKSPACE,
];

export const LONG_NAME_WORKSPACE: WorkspaceCardViewModel = {
  ...MEMBER_WORKSPACE,
  id: 'sample-workspace-long-name',
  displayName:
    '非常に長い表示名のサンプルワークスペース-権限確認用-年度横断プロジェクト-ドラフト共有-最終確認',
  unreadAnnouncementCount: 8,
  unreadConversationCount: 1,
  activeProjectCount: 7,
  lastUpdatedLabel: '今日 11:05',
  capabilities: ['openWorkspace', 'openProjects'],
};

export const MANY_WORKSPACES: readonly WorkspaceCardViewModel[] = Array.from(
  { length: 14 },
  (_, index) => ({
    ...MEMBER_WORKSPACE,
    id: `sample-workspace-many-${index + 1}`,
    displayName: `サンプルワークスペース ${String(index + 1).padStart(2, '0')}`,
    unreadAnnouncementCount: index % 5,
    unreadConversationCount: (index + 2) % 6,
    activeProjectCount: index % 4,
    lastUpdatedLabel: `${index + 1}日前`,
    capabilities:
      index % 3 === 0 ? (['openWorkspace'] as const) : (['openWorkspace', 'openProjects'] as const),
  }),
);

export const DEFAULT_WORKSPACE_DASHBOARD: WorkspaceDashboardViewModel = {
  status: 'ready',
  title: 'ワークスペース',
  subtitle: '参加中のワークスペース',
  workspaces: DEFAULT_WORKSPACES,
  pageCapabilities: ['createWorkspace'],
};

export const WORKSPACE_DASHBOARD_SCENARIOS = {
  default: DEFAULT_WORKSPACE_DASHBOARD,
  loading: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    status: 'loading',
    workspaces: [],
  },
  empty: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: [],
    pageCapabilities: ['createWorkspace'],
  },
  error: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    status: 'error',
    workspaces: [],
    pageCapabilities: [],
    message: '一部の情報を取得できませんでした。',
  },
  permissionDenied: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    status: 'permissionDenied',
    workspaces: [],
    pageCapabilities: [],
    message: 'このワークスペースを表示する権限がありません。',
  },
  noWorkspaceAccess: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    status: 'noWorkspaceAccess',
    workspaces: [],
    pageCapabilities: [],
    message: '表示できるワークスペースがありません。',
  },
  many: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: MANY_WORKSPACES,
  },
  systemAdmin: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: [SYSTEM_ADMIN_WORKSPACE],
    pageCapabilities: [],
  },
  zeroCounts: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: [READ_ONLY_WORKSPACE],
    pageCapabilities: [],
  },
  longWorkspaceNames: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: [LONG_NAME_WORKSPACE, ...DEFAULT_WORKSPACES],
    pageCapabilities: [],
  },
} satisfies Record<string, WorkspaceDashboardViewModel>;
