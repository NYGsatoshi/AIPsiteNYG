export type AnnouncementPriority = 'normal' | 'important' | 'urgent';

export const ANNOUNCEMENT_PRIORITY_LABELS: Record<AnnouncementPriority, string> = {
  normal: '通常',
  important: '重要',
  urgent: '至急'
};

// TODO(API): Verify the exact backend enum names and wire serialization explicitly before replacing mock data.
export type AnnouncementAudienceScope = 'allWorkspaceMembers' | 'guardiansOnly' | 'teachersOnly' | 'adminOnly';

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudienceScope, string> = {
  allWorkspaceMembers: 'ワークスペース全体',
  guardiansOnly: '保護者',
  teachersOnly: '教職員',
  adminOnly: '管理者'
};

export interface AnnouncementAudienceOption {
  readonly scope: AnnouncementAudienceScope;
  readonly displayName: string;
  readonly recipientCount?: number;
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
  readonly audienceScope: AnnouncementAudienceScope;
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
