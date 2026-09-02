import { mapWorkspaceDashboardItem, WorkspaceDashboardListItemDto } from './workspaces.api';

const reviewTaskId = '11111111-1111-4111-8111-111111111111';
const reviewProjectId = '22222222-2222-4222-8222-222222222222';
const failedTaskId = '33333333-3333-4333-8333-333333333333';
const failedProjectId = '44444444-4444-4444-8444-444444444444';

const dashboardItem = (
  overrides: Partial<WorkspaceDashboardListItemDto> = {},
): WorkspaceDashboardListItemDto => ({
  id: 'workspace-1',
  name: 'Canonical Workspace',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  currentUserRole: 'Member',
  accessSource: 'WorkspaceMembership',
  canOpenWorkspace: true,
  canOpenMembers: true,
  canOpenProjects: true,
  canCreateProject: false,
  canAddFiles: false,
  unreadAnnouncementCount: 0,
  unreadConversationCount: 0,
  inProgressProjectCount: 0,
  runningProjectCount: 0,
  needsReviewProjectCount: 0,
  ...overrides,
});

describe('Workspace needs-attention API mapper', () => {
  it('maps only normalized actionable kinds and canonical Task routes', () => {
    const card = mapWorkspaceDashboardItem(dashboardItem({
      needsAttentionCount: 2,
      needsAttentionItems: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          kind: 'ReviewRequired',
          targetRoute: `/projects/${reviewProjectId}/tasks/${reviewTaskId}`,
          occurredAt: '2026-09-01T08:00:00Z',
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          kind: 'ResearchFailed',
          targetRoute: `/projects/${failedProjectId}/tasks/${failedTaskId}`,
          occurredAt: '2026-09-01T09:00:00Z',
        },
      ],
    }));

    expect(card.needsAttentionCount).toBe(2);
    expect(card.needsAttentionItems).toEqual([
      expect.objectContaining({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        kind: 'ReviewRequired',
        label: '確認が必要なTaskがあります',
        targetRoute: `/projects/${reviewProjectId}/tasks/${reviewTaskId}`,
      }),
      expect.objectContaining({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        kind: 'ResearchFailed',
        label: 'Researchの実行に失敗しました',
        targetRoute: `/projects/${failedProjectId}/tasks/${failedTaskId}`,
      }),
    ]);
  });

  it('fails individual target navigation closed instead of accepting arbitrary or external routes', () => {
    const card = mapWorkspaceDashboardItem(dashboardItem({
      needsAttentionCount: 3,
      needsAttentionItems: [
        {
          id: 'safe-item',
          kind: 'ReviewRequired',
          targetRoute: `/projects/${reviewProjectId}/tasks/${reviewTaskId}`,
          occurredAt: '2026-09-01T08:00:00Z',
        },
        {
          id: 'external-item',
          kind: 'ResearchFailed',
          targetRoute: 'https://example.invalid/private-target',
          occurredAt: '2026-09-01T09:00:00Z',
        },
        {
          id: 'unknown-kind',
          kind: 'PermissionGranted',
          targetRoute: `/projects/${failedProjectId}/tasks/${failedTaskId}`,
          occurredAt: '2026-09-01T10:00:00Z',
        },
      ],
    }));

    expect(card.needsAttentionCount).toBe(3);
    expect(card.needsAttentionItems).toHaveLength(1);
    expect(card.needsAttentionItems?.[0]?.id).toBe('safe-item');
  });

  it('maps an absent or resolved attention projection to zero current items', () => {
    const absent = mapWorkspaceDashboardItem(dashboardItem());
    const resolved = mapWorkspaceDashboardItem(dashboardItem({
      needsAttentionCount: 0,
      needsAttentionItems: [],
    }));

    expect(absent.needsAttentionCount).toBe(0);
    expect(absent.needsAttentionItems).toEqual([]);
    expect(resolved.needsAttentionCount).toBe(0);
    expect(resolved.needsAttentionItems).toEqual([]);
  });
});
