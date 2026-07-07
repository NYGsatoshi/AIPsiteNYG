import {
  mapAnnouncementDetail,
  mapAnnouncementListItem,
} from './announcements.api';

describe('announcement API adapters', () => {
  it('maps list DTOs without presenting placeholder body as real detail', () => {
    const announcement = mapAnnouncementListItem({
      id: 'announcement-1',
      title: 'Published notice',
      priority: 'Important',
      requiresReadConfirmation: true,
      isRead: false,
      publishedAt: '2026-07-07T00:00:00Z',
    });

    expect(announcement.id).toBe('announcement-1');
    expect(announcement.title).toBe('Published notice');
    expect(announcement.priority).toBe('important');
    expect(announcement.body).toBe('');
    expect(announcement.detailState).toBe('notLoaded');
    expect(announcement.capabilities).toEqual(['readAnnouncement']);
    expect(announcement.readState.requiresReadConfirmation).toBe(true);
  });

  it('maps detail DTO body only after the detail endpoint returns it', () => {
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
    expect(announcement.priority).toBe('urgent');
    expect(announcement.readState.isRead).toBe(true);
  });
});
