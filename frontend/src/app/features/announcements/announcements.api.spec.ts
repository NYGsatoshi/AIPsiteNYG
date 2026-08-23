import {
  mapAnnouncementAudienceOption,
  mapAnnouncementDetail,
  mapAnnouncementListItem,
  toCreateAnnouncementRequest,
} from './announcements.api';

describe('announcement API adapters', () => {
  it('maps list DTOs without presenting placeholder body as real detail', () => {
    const announcement = mapAnnouncementListItem({
      id: 'announcement-1',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      title: 'Published notice',
      priority: 'Important',
      requiresReadConfirmation: true,
      isRead: false,
      publishedAt: '2026-07-07T00:00:00Z',
    });

    expect(announcement.id).toBe('announcement-1');
    expect(announcement.title).toBe('Published notice');
    expect(announcement.priority).toBe('important');
    expect(announcement.audienceScope).toBe('workspace');
    expect(announcement.body).toBe('');
    expect(announcement.detailState).toBe('notLoaded');
    expect(announcement.capabilities).toEqual(['readAnnouncement']);
    expect(announcement.readState.requiresReadConfirmation).toBe(true);
  });

  it('uses the most specific backend scope for channel, group, workspace, and global announcements', () => {
    const workspaceId = '11111111-1111-1111-1111-111111111111';
    const groupId = '22222222-2222-2222-2222-222222222222';
    const channelId = '33333333-3333-3333-3333-333333333333';

    expect(mapAnnouncementListItem({ workspaceId, groupId, channelId }).audienceScope).toBe('channel');
    expect(mapAnnouncementListItem({ workspaceId, groupId }).audienceScope).toBe('group');
    expect(mapAnnouncementListItem({ workspaceId }).audienceScope).toBe('workspace');
    expect(mapAnnouncementListItem({}).audienceScope).toBe('global');
  });

  it('maps only complete authorization-filtered audience options', () => {
    expect(mapAnnouncementAudienceOption({
      key: 'group:22222222-2222-2222-2222-222222222222',
      scopeType: 'group',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      groupId: '22222222-2222-2222-2222-222222222222',
      displayName: 'School / Teachers',
      estimatedRecipientCount: 86,
    })).toEqual({
      key: 'group:22222222-2222-2222-2222-222222222222',
      scope: 'group',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      groupId: '22222222-2222-2222-2222-222222222222',
      channelId: undefined,
      displayName: 'School / Teachers',
      recipientCount: 86,
    });

    expect(mapAnnouncementAudienceOption({
      key: 'group:bad',
      scopeType: 'group',
      displayName: 'School / Teachers',
    })).toBeNull();
  });

  it('serializes the reviewed audience ids and critical priority for create', () => {
    expect(toCreateAnnouncementRequest({
      title: 'Safety update',
      body: 'Review this notice',
      priority: 'critical',
      requiresReadConfirmation: true,
      audience: {
        key: 'channel:33333333-3333-3333-3333-333333333333',
        scope: 'channel',
        displayName: 'School / AIP / #announcements',
        recipientCount: 32,
        workspaceId: '11111111-1111-1111-1111-111111111111',
        groupId: '22222222-2222-2222-2222-222222222222',
        channelId: '33333333-3333-3333-3333-333333333333',
      },
    })).toEqual({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      groupId: '22222222-2222-2222-2222-222222222222',
      channelId: '33333333-3333-3333-3333-333333333333',
      title: 'Safety update',
      body: 'Review this notice',
      priority: 2,
      isPinned: false,
      requiresReadConfirmation: true,
    });
  });

  it('maps the legacy backend urgent value to the critical UI semantic', () => {
    const announcement = mapAnnouncementDetail({
      id: 'announcement-1',
      title: 'Published notice',
      body: 'Real backend body',
      priority: 2,
      requiresReadConfirmation: false,
      isRead: true,
      publishedAt: '2026-07-07T00:00:00Z',
    });

    expect(announcement.body).toBe('Real backend body');
    expect(announcement.detailState).toBe('loaded');
    expect(announcement.priority).toBe('critical');
    expect(announcement.readState.isRead).toBe(true);
  });

  it('accepts critical when the API adopts the new semantic name', () => {
    expect(mapAnnouncementListItem({ priority: 'Critical' }).priority).toBe('critical');
  });
});
