export type AnnouncementPriority = 'normal' | 'important' | 'critical';

export interface AnnouncementPriorityDefinition {
  readonly label: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  readonly description: string;
}

export const ANNOUNCEMENT_PRIORITY_DEFINITIONS: Record<AnnouncementPriority, AnnouncementPriorityDefinition> = {
  normal: {
    label: 'NORMAL',
    description: '通常のお知らせです。特別な即時対応は求めません。'
  },
  important: {
    label: 'IMPORTANT',
    description: '見落としを避ける必要がある重要なお知らせです。'
  },
  critical: {
    label: 'CRITICAL',
    description: '障害、セキュリティ、期限付き必須対応など、直ちに確認すべき場合に限定して使用します。'
  }
};

export const ANNOUNCEMENT_PRIORITY_LABELS: Record<AnnouncementPriority, string> = {
  normal: ANNOUNCEMENT_PRIORITY_DEFINITIONS.normal.label,
  important: ANNOUNCEMENT_PRIORITY_DEFINITIONS.important.label,
  critical: ANNOUNCEMENT_PRIORITY_DEFINITIONS.critical.label
};

export type AnnouncementAudienceScope = 'global' | 'workspace' | 'group' | 'channel';

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudienceScope, string> = {
  global: 'テナント全体',
  workspace: 'ワークスペース',
  group: 'グループ',
  channel: 'チャンネル'
};

export interface AnnouncementAudienceOption {
  readonly key: string;
  readonly scope: AnnouncementAudienceScope;
  readonly displayName: string;
  readonly recipientCount?: number;
  readonly workspaceId?: string;
  readonly groupId?: string;
  readonly channelId?: string;
  /** Server-resolved Workspace -> Tenant -> UTC organizational default. */
  readonly scheduleTimeZoneId?: string;
}

/** A recipient-visible action. URLs are revalidated by both API and mapper. */
export interface AnnouncementActionLink {
  readonly label: string;
  readonly url: string;
}

export interface AnnouncementEditorSubmission {
  /** Durable server draft identity; absent until the first successful save. */
  readonly draftId?: string;
  /** Optimistic version supplied by the server-owned draft workflow. */
  readonly draftVersion?: number;
  /** Browser retry identities, never authority for target or publication. */
  readonly createIdempotencyKey?: string;
  readonly transitionIdempotencyKey?: string;
  readonly title: string;
  readonly body: string;
  readonly priority: AnnouncementPriority;
  readonly audience: AnnouncementAudienceOption;
  readonly requiresReadConfirmation: boolean;
  readonly cta?: AnnouncementActionLink;
  readonly attachment?: AnnouncementActionLink;
  readonly deliveryMode?: AnnouncementDeliveryMode;
  /** A local wall-clock value without a UTC offset. The server resolves it. */
  readonly scheduledLocalDateTime?: string;
  /** Server-authoritative organizational IANA time-zone ID shown to the user. */
  readonly timeZoneId?: string;
}

export type AnnouncementDeliveryMode = 'now' | 'scheduled';

/**
 * Current-tab presentation only. It is not persisted, routed, or sent as an
 * Announcement API command.
 */
export interface AnnouncementLocalPreview {
  readonly title: string;
  readonly body: string;
  readonly priority: AnnouncementPriority;
  readonly audience: AnnouncementAudienceOption;
  readonly requiresReadConfirmation: boolean;
  readonly cta?: AnnouncementActionLink;
  readonly attachment?: AnnouncementActionLink;
}

export type AnnouncementCapability = 'readAnnouncement' | 'createAnnouncement' | 'editAnnouncement';

export type AnnouncementPageStatus = 'ready' | 'loading' | 'empty' | 'error' | 'permissionDenied' | 'recordAccessDenied';

export type AnnouncementPublicationState = 'draft' | 'scheduled' | 'published' | 'updated' | 'archived';

export const ANNOUNCEMENT_PUBLICATION_STATE_LABELS: Record<AnnouncementPublicationState, string> = {
  draft: '下書き',
  scheduled: '予約済み',
  published: '公開済み',
  updated: '更新済み',
  archived: 'アーカイブ済み'
};

export type AnnouncementDetailState = 'notLoaded' | 'loading' | 'loaded' | 'unavailable' | 'error';

export interface AnnouncementReadStateViewModel {
  readonly requiresReadConfirmation: boolean;
  readonly isRead: boolean;
  /** The command is in flight; the persisted state remains unchanged until the server confirms it. */
  readonly isMarkingRead: boolean;
  /** A generic, local retry message. API error details are never rendered here. */
  readonly markReadError?: string;
}

export interface AnnouncementAttachmentViewModel extends AnnouncementActionLink {
  readonly mode: 'linked';
}

export interface AnnouncementViewModel {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly detailState: AnnouncementDetailState;
  readonly detailMessage?: string;
  readonly priority: AnnouncementPriority;
  readonly audienceScope: AnnouncementAudienceScope;
  readonly publishedAtLabel: string;
  /** Raw server value retained for semantic time rendering when an expiry is present. */
  readonly expiresAt?: string;
  /** Human-readable expiry, not an action deadline. */
  readonly expiresAtLabel?: string;
  readonly publicationState: AnnouncementPublicationState;
  readonly scheduledAtLabel?: string;
  readonly timeZoneLabel?: string;
  readonly readState: AnnouncementReadStateViewModel;
  readonly capabilities: readonly AnnouncementCapability[];
  readonly notificationTarget: 'announcementDetail';
  readonly cta?: AnnouncementActionLink;
  readonly attachment?: AnnouncementAttachmentViewModel;
}

export interface AnnouncementEditorDraft {
  /** Durable workflow identity. It is unrelated to a published announcement ID. */
  readonly id?: string;
  readonly version?: number;
  readonly createIdempotencyKey?: string;
  readonly transitionIdempotencyKey?: string;
  readonly title: string;
  readonly body: string;
  readonly priority: AnnouncementPriority;
  readonly audienceKey: string;
  readonly availableAudiences: readonly AnnouncementAudienceOption[];
  readonly requiresReadConfirmation: boolean;
  readonly cta?: AnnouncementActionLink;
  readonly attachment?: AnnouncementActionLink;
  readonly deliveryMode?: AnnouncementDeliveryMode;
  readonly scheduledLocalDateTime?: string;
  readonly timeZoneId?: string;
  readonly publicationState?: AnnouncementPublicationState;
  readonly scheduledAtLabel?: string;
  readonly timeZoneLabel?: string;
}

export interface AnnouncementsPageViewModel {
  readonly status: AnnouncementPageStatus;
  readonly title: string;
  readonly announcements: readonly AnnouncementViewModel[];
  readonly selectedAnnouncementId: string | null;
  readonly pageCapabilities: readonly AnnouncementCapability[];
  readonly message?: string;
  /** A mutation failure shown inside the still-editable create form. */
  readonly editorError?: string;
  readonly editorDraft?: AnnouncementEditorDraft;
  /** Local command state only; it never represents a persisted publication status. */
  readonly isPublishing?: boolean;
}
