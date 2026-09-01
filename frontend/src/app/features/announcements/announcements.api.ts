import {
  AnnouncementActionLink,
  AnnouncementAttachmentViewModel,
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

export interface AnnouncementActionLinkDto {
  readonly label?: unknown;
  readonly url?: unknown;
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
  readonly cta?: AnnouncementActionLinkDto | null;
  readonly attachment?: AnnouncementActionLinkDto | null;
}

export interface AnnouncementAudienceOptionDto {
  readonly key?: unknown;
  readonly scopeType?: unknown;
  readonly workspaceId?: unknown;
  readonly groupId?: unknown;
  readonly channelId?: unknown;
  readonly displayName?: unknown;
  readonly estimatedRecipientCount?: unknown;
  readonly scheduleTimeZoneId?: unknown;
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
  readonly cta?: AnnouncementActionLinkDto;
  readonly attachment?: AnnouncementActionLinkDto;
}

export interface AnnouncementDraftTargetDto {
  readonly workspaceId?: unknown;
  readonly groupId?: unknown;
  readonly channelId?: unknown;
}

export interface AnnouncementDraftResponseDto {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly status?: unknown;
  readonly workspaceId?: unknown;
  readonly groupId?: unknown;
  readonly channelId?: unknown;
  readonly targets?: unknown;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly priority?: unknown;
  readonly isPinned?: unknown;
  readonly requiresReadConfirmation?: unknown;
  readonly cta?: AnnouncementActionLinkDto | null;
  readonly attachment?: AnnouncementActionLinkDto | null;
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
  readonly targets?: readonly {
    readonly workspaceId: string | null;
    readonly groupId: string | null;
    readonly channelId: string | null;
  }[];
  readonly title: string;
  readonly body: string;
  readonly priority: number;
  readonly isPinned: boolean;
  readonly requiresReadConfirmation: boolean;
  readonly expiresAt: null;
  readonly cta?: AnnouncementActionLinkDto;
  readonly attachment?: AnnouncementActionLinkDto;
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
  const cta = mapActionLink(dto.cta);
  const attachment = mapActionLink(dto.attachment);
  return toAnnouncement(dto, {
    body: stringValue(dto.body) ?? '',
    detailState: 'loaded',
    ...(cta ? { cta } : {}),
    ...(attachment
      ? { attachment: { ...attachment, mode: 'linked' as const } satisfies AnnouncementAttachmentViewModel }
      : {}),
  });
}

export function mapAnnouncementAudienceOption(dto: AnnouncementAudienceOptionDto): AnnouncementAudienceOption | null {
  const key = stringValue(dto.key);
  const scope = audienceScope(dto.scopeType);
  const displayName = stringValue(dto.displayName);
  const recipientCount = nonNegativeInteger(dto.estimatedRecipientCount);
  const scheduleTimeZoneId = stringValue(dto.scheduleTimeZoneId) ?? 'UTC';
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
    scheduleTimeZoneId,
  };
}

export function toCreateAnnouncementRequest(submission: AnnouncementEditorSubmission): CreateAnnouncementRequestDto {
  const cta = toActionLinkDto(submission.cta);
  const attachment = toActionLinkDto(submission.attachment);
  return {
    workspaceId: submission.audience.workspaceId ?? null,
    groupId: submission.audience.groupId ?? null,
    channelId: submission.audience.channelId ?? null,
    title: submission.title,
    body: submission.body,
    priority: priorityNumber(submission.priority),
    isPinned: false,
    requiresReadConfirmation: submission.requiresReadConfirmation,
    ...(cta ? { cta } : {}),
    ...(attachment ? { attachment } : {}),
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

  const hasExplicitTargets = Array.isArray(dto.targets) && dto.targets.length > 0;
  const rawTargets = announcementDraftTargets(dto);
  const selectedAudiences = rawTargets
    .map((target) => audiences.find((candidate) => targetMatchesAudience(target, candidate)))
    .filter((candidate): candidate is AnnouncementAudienceOption => candidate !== undefined);
  if (hasExplicitTargets && selectedAudiences.length !== rawTargets.length) {
    return null;
  }

  const cta = mapActionLink(dto.cta);
  const attachment = mapActionLink(dto.attachment);
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
    audienceKey: selectedAudiences[0]?.key ?? '',
    audienceKeys: selectedAudiences.map((audience) => audience.key),
    availableAudiences: audiences,
    requiresReadConfirmation: dto.requiresReadConfirmation === true,
    ...(cta ? { cta } : {}),
    ...(attachment ? { attachment } : {}),
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
  detail: Pick<
    AnnouncementViewModel,
    'body' | 'detailState' | 'detailMessage' | 'cta' | 'attachment'
  >,
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
    ...(detail.cta ? { cta: detail.cta } : {}),
    ...(detail.attachment ? { attachment: detail.attachment } : {}),
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

function trimmedStringValue(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.length > 0 ? raw : undefined;
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
  const cta = toActionLinkDto(submission.cta);
  const attachment = toActionLinkDto(submission.attachment);
  const selectedAudiences = submission.audiences?.length ? submission.audiences : [submission.audience];
  const targets = selectedAudiences.map((audience) => ({
    workspaceId: audience.workspaceId ?? null,
    groupId: audience.groupId ?? null,
    channelId: audience.channelId ?? null,
  }));
  return {
    target: targets[0],
    ...(targets.length > 1 ? { targets } : {}),
    title: submission.title,
    body: submission.body,
    priority: priorityNumber(submission.priority),
    isPinned: false,
    requiresReadConfirmation: submission.requiresReadConfirmation,
    expiresAt: null,
    ...(cta ? { cta } : {}),
    ...(attachment ? { attachment } : {}),
  };
}

function announcementDraftTargets(dto: AnnouncementDraftResponseDto): readonly AnnouncementDraftTargetDto[] {
  if (Array.isArray(dto.targets) && dto.targets.length > 0) {
    return dto.targets.filter(
      (target): target is AnnouncementDraftTargetDto => typeof target === 'object' && target !== null,
    );
  }
  return [{ workspaceId: dto.workspaceId, groupId: dto.groupId, channelId: dto.channelId }];
}

function targetMatchesAudience(
  target: AnnouncementDraftTargetDto,
  audience: AnnouncementAudienceOption,
): boolean {
  return (
    nullableString(audience.workspaceId) === nullableString(target.workspaceId) &&
    nullableString(audience.groupId) === nullableString(target.groupId) &&
    nullableString(audience.channelId) === nullableString(target.channelId)
  );
}

function mapActionLink(value: AnnouncementActionLinkDto | null | undefined): AnnouncementActionLink | undefined {
  const label = trimmedStringValue(value?.label);
  const url = trimmedStringValue(value?.url);
  if (!label || label.length > 120 || !url || !isSafeAnnouncementUrl(url)) {
    return undefined;
  }

  return { label, url };
}

function toActionLinkDto(value: AnnouncementActionLink | undefined): AnnouncementActionLinkDto | undefined {
  if (!value) {
    return undefined;
  }

  return {
    label: value.label.trim(),
    url: value.url.trim(),
  };
}

export function isSafeAnnouncementUrl(rawUrl: string): boolean {
  const value = rawUrl.trim();
  if (
    value.length === 0 ||
    value.length > 2_048 ||
    /[\u0000-\u001f\u007f\\\s]/u.test(value)
  ) {
    return false;
  }

  if (value.startsWith('/')) {
    if (value.startsWith('//')) {
      return false;
    }

    try {
      return !decodeURIComponent(value)
        .split('/')
        .some((segment) => segment === '..');
    } catch {
      return false;
    }
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
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
    return `${formatScheduleWallClock(localDateTime)} ${timeZoneId}`;
  }
  return formatDate(dueAtUtc) || 'Scheduled time accepted';
}

function formatScheduleWallClock(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, Number(month) - 1, 1)));
  return `${monthLabel} ${Number(day)}, ${year} · ${hour}:${minute}`;
}