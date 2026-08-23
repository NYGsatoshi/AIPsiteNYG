import {
  AnnouncementPriority,
  AnnouncementViewModel,
} from './announcements.types';

export interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

export interface AnnouncementListItemDto {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly priority?: unknown;
  readonly isPinned?: unknown;
  readonly isRead?: unknown;
  readonly requiresReadConfirmation?: unknown;
  readonly publishedAt?: unknown;
}

export interface AnnouncementDetailDto extends AnnouncementListItemDto {
  readonly body?: unknown;
  readonly updatedAt?: unknown;
}

export function mapAnnouncementListItem(dto: AnnouncementListItemDto): AnnouncementViewModel {
  return toAnnouncement(dto, {
    body: '',
    detailState: 'notLoaded',
    detailMessage: '詳細は選択後に読み込みます。',
  });
}

export function mapAnnouncementDetail(dto: AnnouncementDetailDto): AnnouncementViewModel {
  return toAnnouncement(dto, {
    body: stringValue(dto.body) ?? '',
    detailState: 'loaded',
  });
}

export function markAnnouncementDetailLoading(
  announcement: AnnouncementViewModel,
): AnnouncementViewModel {
  return {
    ...announcement,
    detailState: 'loading',
    detailMessage: '詳細を読み込んでいます。',
  };
}

export function markAnnouncementDetailUnavailable(
  announcement: AnnouncementViewModel,
  message = '詳細はMVP0では利用できません。',
): AnnouncementViewModel {
  return {
    ...announcement,
    body: '',
    detailState: 'unavailable',
    detailMessage: message,
  };
}

export function markAnnouncementReadConfirmed(
  announcement: AnnouncementViewModel,
  confirmedAtLabel: string,
): AnnouncementViewModel {
  return {
    ...announcement,
    readState: {
      ...announcement.readState,
      isRead: true,
      confirmedAtLabel,
    },
  };
}

function toAnnouncement(
  dto: AnnouncementListItemDto,
  detail: Pick<AnnouncementViewModel, 'body' | 'detailState' | 'detailMessage'>,
): AnnouncementViewModel {
  const id = stringValue(dto.id) ?? '';
  const isRead = dto.isRead === true;

  return {
    id,
    title: stringValue(dto.title) ?? 'Untitled announcement',
    body: detail.body,
    detailState: detail.detailState,
    detailMessage: detail.detailMessage,
    priority: announcementPriority(dto.priority),
    audienceScope: 'allWorkspaceMembers',
    publishedAtLabel: formatDate(dto.publishedAt),
    publicationState: 'published',
    readState: {
      requiresReadConfirmation: dto.requiresReadConfirmation === true,
      isRead,
    },
    capabilities: ['readAnnouncement'],
    notificationTarget: 'announcementDetail',
    attachment: {
      mode: 'disabled',
      label: '添付ファイルはMVP0では利用できません。',
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatDate(value: unknown): string {
  const raw = stringValue(value);
  return raw ? new Date(raw).toLocaleString() : '';
}

function announcementPriority(value: unknown): AnnouncementPriority {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === '1' || normalized === 'important') {
    return 'important';
  }
  if (normalized === '2' || normalized === 'urgent' || normalized === 'critical') {
    return 'critical';
  }
  return 'normal';
}
