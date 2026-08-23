import {
  WorkspaceActionCapability,
  WorkspaceCardViewModel,
  WorkspaceDashboardAccessSource,
  WorkspaceMembershipRole,
  WorkspacePageCapability,
  WorkspaceRoleLabel,
} from './workspaces.types';

export interface WorkspaceDashboardListItemDto {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly icon?: unknown;
  readonly status?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
  readonly currentUserRole?: unknown;
  readonly accessSource?: unknown;
  readonly canOpenWorkspace?: unknown;
  readonly canOpenMembers?: unknown;
  readonly canOpenProjects?: unknown;
  readonly canCreateProject?: unknown;
  readonly canAddFiles?: unknown;
  readonly unreadAnnouncementCount?: unknown;
  readonly unreadConversationCount?: unknown;
  readonly inProgressProjectCount?: unknown;
  readonly runningProjectCount?: unknown;
  readonly needsReviewProjectCount?: unknown;
}

export interface WorkspaceCapabilitiesDto {
  readonly canCreate?: unknown;
}

export interface WorkspaceCapabilitiesEnvelopeDto {
  readonly requestId?: unknown;
  readonly data?: WorkspaceCapabilitiesDto | null;
  readonly warnings?: readonly unknown[];
}

export function mapWorkspaceDashboardResponse(value: unknown): readonly WorkspaceCardViewModel[] {
  if (!Array.isArray(value)) {
    throw new Error('Workspace dashboard response must be an array.');
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Workspace dashboard item ${index} is invalid.`);
    }

    return mapWorkspaceDashboardItem(item as WorkspaceDashboardListItemDto, index);
  });
}

export function mapWorkspacePageCapabilities(
  response: unknown,
): readonly WorkspacePageCapability[] {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return [];
  }

  const envelope = response as WorkspaceCapabilitiesEnvelopeDto;
  return envelope.data?.canCreate === true ? ['createWorkspace'] : [];
}

export function mapWorkspaceDashboardItem(
  workspace: WorkspaceDashboardListItemDto,
  index = 0,
): WorkspaceCardViewModel {
  const id = stringValue(workspace.id);
  if (!id) {
    throw new Error(`Workspace dashboard item ${index} is missing an id.`);
  }

  const currentUserRole = membershipRole(workspace.currentUserRole);
  const accessSource = dashboardAccessSource(workspace.accessSource);
  const unreadAnnouncementCount = nonNegativeInteger(workspace.unreadAnnouncementCount);
  const unreadConversationCount = nonNegativeInteger(workspace.unreadConversationCount);
  const runningProjectCount = nonNegativeInteger(workspace.runningProjectCount);
  const needsReviewProjectCount = nonNegativeInteger(workspace.needsReviewProjectCount);
  const activeProjectCount =
    nonNegativeInteger(workspace.inProgressProjectCount) ??
    (runningProjectCount !== null && needsReviewProjectCount !== null
      ? runningProjectCount + needsReviewProjectCount
      : null);
  const lastUpdatedLabel = dateLabel(workspace.updatedAt) ?? dateLabel(workspace.createdAt);

  return {
    id,
    displayName: stringValue(workspace.name) ?? 'Workspace',
    currentUserRole,
    accessSource,
    roleLabel: roleLabel(currentUserRole, accessSource),
    unreadAnnouncementCount,
    unreadConversationCount,
    activeProjectCount,
    runningProjectCount,
    needsReviewProjectCount,
    lastUpdatedLabel,
    availability: {
      unreadAnnouncements: unreadAnnouncementCount !== null,
      unreadConversations: unreadConversationCount !== null,
      activeProjects: activeProjectCount !== null,
      runningProjects: runningProjectCount !== null,
      needsReviewProjects: needsReviewProjectCount !== null,
      lastUpdated: lastUpdatedLabel !== null,
    },
    capabilities: actionCapabilities(workspace),
  };
}

function actionCapabilities(
  workspace: WorkspaceDashboardListItemDto,
): readonly WorkspaceActionCapability[] {
  const capabilities: WorkspaceActionCapability[] = [];
  if (workspace.canOpenWorkspace === true) {
    capabilities.push('openWorkspace');
  }
  if (workspace.canOpenMembers === true) {
    capabilities.push('openMembers');
  }
  if (workspace.canOpenProjects === true) {
    capabilities.push('openProjects');
  }
  if (workspace.canCreateProject === true) {
    capabilities.push('createProject');
  }
  if (workspace.canAddFiles === true) {
    capabilities.push('addFiles');
  }
  return capabilities;
}

function membershipRole(value: unknown): WorkspaceMembershipRole | null {
  return value === 'Owner' ||
    value === 'Admin' ||
    value === 'Adviser' ||
    value === 'Member' ||
    value === 'ReadOnly'
    ? value
    : null;
}

function dashboardAccessSource(value: unknown): WorkspaceDashboardAccessSource | null {
  return value === 'WorkspaceMembership' || value === 'SystemAdmin' ? value : null;
}

function roleLabel(
  role: WorkspaceMembershipRole | null,
  accessSource: WorkspaceDashboardAccessSource | null,
): WorkspaceRoleLabel {
  if (accessSource === 'SystemAdmin' && role === null) {
    return 'システム管理者アクセス';
  }

  switch (role) {
    case 'Owner':
    case 'Admin':
      return '管理者';
    case 'Adviser':
      return '先生';
    case 'Member':
      return 'メンバー';
    case 'ReadOnly':
      return '閲覧のみ';
    default:
      return '役割情報なし';
  }
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function dateLabel(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('ja-JP');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
