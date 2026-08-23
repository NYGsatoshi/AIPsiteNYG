import {
  AnnouncementAudienceOption,
  AnnouncementAudienceScope,
  AnnouncementEditorSubmission,
  AnnouncementPriority,
  AnnouncementViewModel,
} from './announcements.types';

export interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

export interface AnnouncementListItemDto {
  readonly id?: unknown;
  readonly workspaceId?: unknown;
  readonly groupId?: unknown;
  readonly channelId?: unknown;
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

export interface AnnouncementAudienceOptionDto {
  readonly key?: unknown;
  readonly scopeType?: unknown;
  readonly workspaceId?: unknown;
  readonly groupId?: unknown;
  readonly channelId?: unknown;
  readonly displayName?: unknown;
  readonly estimatedRecipientCount?: unknown;
}

export interface CreateAnnouncementRequestDto {
  readonly workspaceId: string | null;
  readonly groupId: string | null;
  readonly channelId: string | null;
  readonly title: string;
  readonly body: string;
  readonly priority: number;
  readonly isPinned: boolean;
  readonly requiresReadConfirmation: boolean;
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

export function mapAnnouncementAudienceOption(dto: AnnouncementAudienceOptionDto): AnnouncementAudienceOption | null {
  const key = stringValue(dto.key);
  const scope = audienceScope(dto.scopeType);
  const displayName = stringValue(dto.displayName);
  const recipientCount = nonNegativeInteger(dto.estimatedRecipientCount);
  if (!key || !scope || !displayName || recipientCount === undefined) {
    return null;
  }

  return {
    key,
    scope,
    displayName,
    recipientCount,
    workspaceId: stringValue(dto.workspaceId),
    groupId: stringValue(dto.groupId),
    channelId: stringValue(dto.channelId),
  };
}

export function toCreateAnnouncementRequest(submission: AnnouncementEditorSubmission): CreateAnnouncementRequestDto {
  return {
    workspaceId: submission.audience.workspaceId ?? null,
    groupId: submission.audience.groupId ?? null,
    channelId: submission.audience.channelId ?? null,
    title: submission.title,
    body: submission.body,
    priority: priorityNumber(submission.priority),
    isPinned: false,
    requiresReadConfirmation: submission.requiresReadConfirmation,
  };
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
    audienceScope: announcementAudienceScope(dto),
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

function announcementAudienceScope(dto: AnnouncementListItemDto): AnnouncementAudienceScope {
  if (stringValue(dto.channelId)) {
    return 'channel';
  }
  if (stringValue(dto.groupId)) {
    return 'group';
  }
  if (stringValue(dto.workspaceId)) {
    return 'workspace';
  }
  return 'global';
}

function audienceScope(value: unknown): AnnouncementAudienceScope | null {
  return value === 'global' || value === 'workspace' || value === 'group' || value === 'channel'
    ? value
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
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

function priorityNumber(priority: AnnouncementPriority): number {
  switch (priority) {
    case 'important':
      return 1;
    case 'critical':
      return 2;
    default:
      return 0;
  }
}
