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
}

export interface AnnouncementEditorSubmission {
  readonly title: string;
  readonly body: string;
  readonly priority: AnnouncementPriority;
  readonly audience: AnnouncementAudienceOption;
  readonly requiresReadConfirmation: boolean;
}

export type AnnouncementCapability = 'readAnnouncement' | 'createAnnouncement' | 'editAnnouncement';

export type AnnouncementPageStatus = 'ready' | 'loading' | 'empty' | 'error' | 'permissionDenied' | 'recordAccessDenied';

export type AnnouncementPublicationState = 'draft' | 'published';

export type AnnouncementDetailState = 'notLoaded' | 'loading' | 'loaded' | 'unavailable' | 'error';

export interface AnnouncementReadStateViewModel {
  readonly requiresReadConfirmation: boolean;
  readonly isRead: boolean;
  readonly confirmedAtLabel?: string;
}

export interface AnnouncementAttachmentViewModel {
  readonly mode: 'disabled';
  readonly label: string;
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
  readonly publicationState: AnnouncementPublicationState;
  readonly readState: AnnouncementReadStateViewModel;
  readonly capabilities: readonly AnnouncementCapability[];
  readonly notificationTarget: 'announcementDetail';
  readonly attachment?: AnnouncementAttachmentViewModel;
}

export interface AnnouncementEditorDraft {
  readonly id?: string;
  readonly title: string;
  readonly body: string;
  readonly priority: AnnouncementPriority;
  readonly audienceKey: string;
  readonly availableAudiences: readonly AnnouncementAudienceOption[];
  readonly requiresReadConfirmation: boolean;
}

export interface AnnouncementsPageViewModel {
  readonly status: AnnouncementPageStatus;
  readonly title: string;
  readonly announcements: readonly AnnouncementViewModel[];
  readonly selectedAnnouncementId: string | null;
  readonly pageCapabilities: readonly AnnouncementCapability[];
  readonly message?: string;
  readonly editorDraft?: AnnouncementEditorDraft;
}
