import { WorkspaceCardViewModel, WorkspaceDashboardViewModel } from './workspaces.types';

const available = {
  unreadAnnouncements: true,
  unreadConversations: true,
  activeProjects: true,
  lastUpdated: true
} as const;

export const DEFAULT_WORKSPACES: readonly WorkspaceCardViewModel[] = [
  {
    id: 'sample-workspace-a',
    displayName: 'サンプル共同ワークスペースA',
    roleLabel: '管理者',
    unreadAnnouncementCount: 3,
    unreadConversationCount: 2,
    activeProjectCount: 5,
    lastUpdatedLabel: '今日 09:40',
    availability: available,
    capabilities: ['openWorkspace', 'openMembers', 'openProjects']
  },
  {
    id: 'sample-workspace-b',
    displayName: '教材準備ワークスペースB',
    roleLabel: '先生',
    unreadAnnouncementCount: 0,
    unreadConversationCount: 4,
    activeProjectCount: 2,
    lastUpdatedLabel: '昨日 16:15',
    availability: available,
    capabilities: ['openWorkspace', 'openProjects']
  },
  {
    id: 'sample-workspace-c',
    displayName: '確認用ワークスペースC',
    roleLabel: '閲覧のみ',
    unreadAnnouncementCount: 1,
    unreadConversationCount: 0,
    activeProjectCount: 1,
    lastUpdatedLabel: '6月30日',
    availability: available,
    capabilities: ['openWorkspace']
  }
];

export const LONG_NAME_WORKSPACE: WorkspaceCardViewModel = {
  id: 'sample-workspace-long-name',
  displayName: '非常に長い表示名のサンプルワークスペース-権限確認用-年度横断プロジェクト-ドラフト共有-最終確認',
  roleLabel: 'メンバー',
  unreadAnnouncementCount: 8,
  unreadConversationCount: 1,
  activeProjectCount: 7,
  lastUpdatedLabel: '今日 11:05',
  availability: available,
  capabilities: ['openWorkspace', 'openProjects']
};

export const PARTIAL_SUMMARY_WORKSPACE: WorkspaceCardViewModel = {
  id: 'sample-workspace-partial',
  displayName: '一部取得できないワークスペース',
  roleLabel: '先生',
  unreadAnnouncementCount: null,
  unreadConversationCount: 2,
  activeProjectCount: null,
  lastUpdatedLabel: null,
  availability: {
    unreadAnnouncements: false,
    unreadConversations: true,
    activeProjects: false,
    lastUpdated: false
  },
  capabilities: ['openWorkspace', 'openMembers']
};

export const MANY_WORKSPACES: readonly WorkspaceCardViewModel[] = Array.from({ length: 14 }, (_, index) => ({
  id: `sample-workspace-many-${index + 1}`,
  displayName: `サンプルワークスペース ${String(index + 1).padStart(2, '0')}`,
  roleLabel: index % 4 === 0 ? '管理者' : index % 3 === 0 ? '閲覧のみ' : 'メンバー',
  unreadAnnouncementCount: index % 5,
  unreadConversationCount: (index + 2) % 6,
  activeProjectCount: (index % 4) + 1,
  lastUpdatedLabel: `${index + 1}日前`,
  availability: available,
  capabilities: index % 3 === 0 ? ['openWorkspace'] : ['openWorkspace', 'openProjects']
}));

export const DEFAULT_WORKSPACE_DASHBOARD: WorkspaceDashboardViewModel = {
  status: 'ready',
  title: 'ワークスペース',
  subtitle: '参加中のワークスペース',
  workspaces: DEFAULT_WORKSPACES,
  pageCapabilities: ['createWorkspace'],
  partialSummaryUnavailable: false
};

export const WORKSPACE_DASHBOARD_SCENARIOS = {
  default: DEFAULT_WORKSPACE_DASHBOARD,
  loading: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    status: 'loading',
    workspaces: []
  },
  empty: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: [],
    pageCapabilities: ['createWorkspace']
  },
  error: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    status: 'error',
    workspaces: [],
    pageCapabilities: [],
    message: '一部の情報を取得できませんでした。'
  },
  permissionDenied: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    status: 'permissionDenied',
    workspaces: [],
    pageCapabilities: [],
    message: 'このワークスペースを表示する権限がありません。'
  },
  noWorkspaceAccess: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    status: 'noWorkspaceAccess',
    workspaces: [],
    pageCapabilities: [],
    message: '表示できるワークスペースがありません。'
  },
  many: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: MANY_WORKSPACES
  },
  partialSummaryUnavailable: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: [PARTIAL_SUMMARY_WORKSPACE, ...DEFAULT_WORKSPACES],
    partialSummaryUnavailable: true
  },
  longWorkspaceNames: {
    ...DEFAULT_WORKSPACE_DASHBOARD,
    workspaces: [LONG_NAME_WORKSPACE, ...DEFAULT_WORKSPACES],
    pageCapabilities: []
  }
} satisfies Record<string, WorkspaceDashboardViewModel>;
