import {
  AnnouncementAudienceOption,
  AnnouncementAudienceScope,
  AnnouncementEditorDraft,
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
  readonly expiresAt?: unknown;
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

export interface AnnouncementDraftResponseDto {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly status?: unknown;
  readonly workspaceId?: unknown;
  readonly groupId?: unknown;
  readonly channelId?: unknown;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly priority?: unknown;
  readonly isPinned?: unknown;
  readonly requiresReadConfirmation?: unknown;
  readonly scheduledForUtc?: unknown;
  readonly scheduleTimeZoneId?: unknown;
  readonly scheduleLocalDateTime?: unknown;
  readonly publishedAnnouncementId?: unknown;
  readonly publishedAtUtc?: unknown;
}

export interface AnnouncementDraftContentRequestDto {
  readonly target: {
    readonly workspaceId: string | null;
    readonly groupId: string | null;
    readonly channelId: string | null;
  };
  readonly title: string;
  readonly body: string;
  readonly priority: number;
  readonly isPinned: boolean;
  readonly requiresReadConfirmation: boolean;
  readonly expiresAt: null;
}

export interface CreateAnnouncementDraftRequestDto {
  readonly content: AnnouncementDraftContentRequestDto;
}

export interface SaveAnnouncementDraftRequestDto {
  readonly expectedVersion: number;
  readonly content: AnnouncementDraftContentRequestDto;
}

export interface PublishAnnouncementDraftRequestDto {
  readonly expectedVersion: number;
}

export interface ScheduleAnnouncementDraftRequestDto {
  readonly expectedVersion: number;
  readonly localDateTime: string;
  readonly timeZoneId: string;
  readonly ambiguousTimeOffsetMinutes: null;
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

export function toCreateAnnouncementDraftRequest(
  submission: AnnouncementEditorSubmission,
): CreateAnnouncementDraftRequestDto {
  return { content: toAnnouncementDraftContentRequest(submission) };
}

export function toSaveAnnouncementDraftRequest(
  submission: AnnouncementEditorSubmission,
  expectedVersion: number,
): SaveAnnouncementDraftRequestDto {
  return {
    expectedVersion,
    content: toAnnouncementDraftContentRequest(submission),
  };
}

export function toPublishAnnouncementDraftRequest(
  expectedVersion: number,
): PublishAnnouncementDraftRequestDto {
  return { expectedVersion };
}

export function toScheduleAnnouncementDraftRequest(
  expectedVersion: number,
  submission: AnnouncementEditorSubmission,
): ScheduleAnnouncementDraftRequestDto | null {
  const localDateTime = submission.scheduledLocalDateTime?.trim();
  const timeZoneId = submission.timeZoneId?.trim();
  if (!localDateTime || !timeZoneId) {
    return null;
  }

  return {
    expectedVersion,
    localDateTime,
    timeZoneId,
    ambiguousTimeOffsetMinutes: null,
  };
}

/**
 * The workflow response is mapped through current authorized audience options.
 * A persisted raw target ID never becomes permission to render an audience
 * name, count, or selectable scope after the user's authorization changed.
 */
export function mapAnnouncementDraft(
  dto: AnnouncementDraftResponseDto,
  audiences: readonly AnnouncementAudienceOption[],
  previous?: AnnouncementEditorDraft,
): AnnouncementEditorDraft | null {
  const id = stringValue(dto.id);
  const version = nonNegativeInteger(dto.version);
  const title = stringValue(dto.title);
  const body = stringValue(dto.body);
  const status = announcementDraftStatus(dto.status);
  if (!id || version === undefined || !title || body === undefined || status === null) {
    return null;
  }

  const audience = audiences.find(
    (candidate) =>
      nullableString(candidate.workspaceId) === nullableString(dto.workspaceId) &&
      nullableString(candidate.groupId) === nullableString(dto.groupId) &&
      nullableString(candidate.channelId) === nullableString(dto.channelId),
  );

  const timeZoneId = stringValue(dto.scheduleTimeZoneId);
  const scheduledLocalDateTime = localDateTimeValue(dto.scheduleLocalDateTime);
  return {
    id,
    version,
    createIdempotencyKey: previous?.createIdempotencyKey,
    transitionIdempotencyKey: previous?.transitionIdempotencyKey,
    title,
    body,
    priority: announcementPriority(dto.priority),
    audienceKey: audience?.key ?? '',
    availableAudiences: audiences,
    requiresReadConfirmation: dto.requiresReadConfirmation === true,
    deliveryMode: status === 'scheduled' ? 'scheduled' : 'now',
    scheduledLocalDateTime,
    timeZoneId,
    publicationState: status,
    scheduledAtLabel:
      status === 'scheduled'
        ? formatAcceptedSchedule(scheduledLocalDateTime, timeZoneId, dto.scheduledForUtc)
        : undefined,
    timeZoneLabel: timeZoneId,
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
): AnnouncementViewModel {
  return {
    ...announcement,
    readState: {
      ...announcement.readState,
      isRead: true,
      isMarkingRead: false,
      markReadError: undefined,
    },
  };
}

export function markAnnouncementReadPending(
  announcement: AnnouncementViewModel,
): AnnouncementViewModel {
  return {
    ...announcement,
    readState: {
      ...announcement.readState,
      isMarkingRead: true,
      markReadError: undefined,
    },
  };
}

export function markAnnouncementReadFailed(
  announcement: AnnouncementViewModel,
): AnnouncementViewModel {
  return {
    ...announcement,
    readState: {
      ...announcement.readState,
      isMarkingRead: false,
      markReadError: 'Could not mark this announcement as read. Try again.',
    },
  };
}

function toAnnouncement(
  dto: AnnouncementListItemDto,
  detail: Pick<AnnouncementViewModel, 'body' | 'detailState' | 'detailMessage'>,
): AnnouncementViewModel {
  const id = stringValue(dto.id) ?? '';
  const isRead = dto.isRead === true;
  const expiresAt = stringValue(dto.expiresAt);

  return {
    id,
    title: stringValue(dto.title) ?? 'Untitled announcement',
    body: detail.body,
    detailState: detail.detailState,
    detailMessage: detail.detailMessage,
    priority: announcementPriority(dto.priority),
    audienceScope: announcementAudienceScope(dto),
    publishedAtLabel: formatDate(dto.publishedAt),
    expiresAt,
    expiresAtLabel: expiresAt ? formatDate(expiresAt) : undefined,
    publicationState: 'published',
    readState: {
      requiresReadConfirmation: dto.requiresReadConfirmation === true,
      isRead,
      isMarkingRead: false,
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

function toAnnouncementDraftContentRequest(
  submission: AnnouncementEditorSubmission,
): AnnouncementDraftContentRequestDto {
  return {
    target: {
      workspaceId: submission.audience.workspaceId ?? null,
      groupId: submission.audience.groupId ?? null,
      channelId: submission.audience.channelId ?? null,
    },
    title: submission.title,
    body: submission.body,
    priority: priorityNumber(submission.priority),
    isPinned: false,
    requiresReadConfirmation: submission.requiresReadConfirmation,
    expiresAt: null,
  };
}

function announcementDraftStatus(value: unknown): AnnouncementEditorDraft['publicationState'] | null {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === '0' || normalized === 'draft') return 'draft';
  if (normalized === '1' || normalized === 'scheduled') return 'scheduled';
  if (normalized === '2' || normalized === 'published') return 'published';
  return null;
}

function nullableString(value: unknown): string | null {
  return stringValue(value) ?? null;
}

/** Retain local wall-clock semantics rather than parsing it as browser-local UTC. */
function localDateTimeValue(value: unknown): string | undefined {
  const raw = stringValue(value);
  return raw && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) ? raw.slice(0, 16) : undefined;
}

function formatAcceptedSchedule(
  localDateTime: string | undefined,
  timeZoneId: string | undefined,
  dueAtUtc: unknown,
): string {
  if (localDateTime && timeZoneId) {
    return `${localDateTime} (${timeZoneId})`;
  }
  return formatDate(dueAtUtc) || 'Scheduled time accepted';
}
