export type MessagingRouteKind = 'channel' | 'dm';

export type MessagingPageStatus =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'permissionDenied'
  | 'removedParticipant'
  | 'manualRefreshError'
  | 'sessionExpired';

export type MessagingCapability =
  | 'readBody'
  | 'postMessage'
  | 'createThread'
  | 'retryMessage'
  | 'viewOwnReadMarker'
  | 'viewOthersPreciseReadTimestamps';

export type MessageDeliveryState = 'confirmed' | 'sending' | 'failed';

export type MessagingMessageActionMode = 'idle' | 'editing' | 'confirmDelete' | 'confirmReport';

export type MessagingMessageActionPending = 'edit' | 'delete' | 'report';

export interface MessagingMessageActionFeedback {
  readonly id: number;
  readonly message: string;
  readonly focusTimeline: boolean;
}

export interface MessagingMessageActionState {
  readonly messageId: string | null;
  readonly mode: MessagingMessageActionMode;
  readonly draft: string;
  readonly pending: MessagingMessageActionPending | null;
  readonly error?: string;
  readonly feedback?: MessagingMessageActionFeedback;
}

export type MessageFailureCode = 'network' | 'permissionDenied' | 'sessionExpired' | 'validation';

export type MessageSendState =
  | { readonly status: 'idle' }
  | { readonly status: 'sending'; readonly clientRequestId?: string }
  | { readonly status: 'sent'; readonly messageId: string }
  | { readonly status: 'failed'; readonly message: string; readonly requestId?: string };

export interface MessagingDraftScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId?: string;
  readonly conversationId: string;
}

export interface MessagingPagingWindow {
  readonly beforeMessageId?: string;
  readonly afterMessageId?: string;
  readonly visibleMessageIds: readonly string[];
  readonly preloadBefore: number;
  readonly preloadAfter: number;
}

export interface MessagingConversationListItem {
  readonly id: string;
  readonly kind: MessagingRouteKind;
  readonly title: string;
  readonly route: string;
  readonly lastActivityLabel: string;
  readonly safePreviewLabel: string;
  readonly viewerIsParticipant: boolean;
  readonly unreadCount?: number;
  readonly hasMention?: boolean;
}

export interface MessagingMentionCandidate {
  readonly userId: string;
  readonly displayName: string;
}

export interface MessagingAttachmentPlaceholder {
  readonly mode: 'disabled';
  readonly label: string;
}

export interface MessagingMessageReadState {
  readonly ownReadLabel?: string;
  readonly otherReadSummaryLabel?: string;
  readonly otherReadPreciseTimestampLabel?: string;
}

export interface MessagingMessageViewModel {
  readonly id: string;
  readonly clientRequestId?: string;
  readonly authorUserId?: string;
  readonly authorLabel: string;
  readonly authorRoleLabel: string;
  readonly isOwnMessage: boolean;
  readonly body: string;
  readonly isDeleted: boolean;
  readonly createdAt?: string;
  readonly editedAt?: string;
  readonly version?: number;
  readonly sentAtLabel: string;
  readonly deliveryState: MessageDeliveryState;
  readonly failureCode?: MessageFailureCode;
  readonly safeFailureReason?: string;
  readonly retryAllowed: boolean;
  readonly readState?: MessagingMessageReadState;
  readonly mentionedUserIds?: readonly string[];
  readonly threadRootMessageId?: string;
  readonly thread?: MessagingThreadSummaryViewModel;
}

export interface MessagingThreadSummaryViewModel {
  readonly threadRootMessageId: string;
  readonly replyCount: number;
  readonly latestReplyAt?: string;
  readonly participantDisplayNames: readonly string[];
}

export type MessagingThreadStatus = 'closed' | 'loading' | 'ready' | 'permissionDenied' | 'error';

export interface MessagingThreadViewModel {
  readonly status: MessagingThreadStatus;
  readonly rootMessageId: string | null;
  readonly rootMessage?: MessagingMessageViewModel;
  readonly replies: readonly MessagingMessageViewModel[];
  readonly summary?: MessagingThreadSummaryViewModel;
  readonly hasMore: boolean;
  readonly maximumReplies: number;
  readonly draft: string;
  readonly sending: boolean;
  readonly pendingClientRequestId?: string;
  readonly triggerElementId?: string;
  readonly error?: string;
}

export interface MessagingConversationViewModel {
  readonly id: string;
  readonly kind: MessagingRouteKind;
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly title: string;
  readonly subtitle: string;
  readonly viewerIsParticipant: boolean;
  readonly viewerWasRemoved: boolean;
  readonly capabilities: readonly MessagingCapability[];
  readonly composerDisabledReason?: string;
  readonly mentionCandidates?: readonly MessagingMentionCandidate[];
  readonly attachment: MessagingAttachmentPlaceholder;
}

export interface MessagingPageViewModel {
  readonly routeKind: MessagingRouteKind;
  readonly status: MessagingPageStatus;
  readonly title: string;
  readonly conversation: MessagingConversationViewModel;
  readonly conversations: readonly MessagingConversationListItem[];
  readonly messages: readonly MessagingMessageViewModel[];
  readonly draft: string;
  readonly sending: boolean;
  readonly sendState: MessageSendState;
  readonly hasNewMessagesWhileReading: boolean;
  readonly inlineError?: string;
  readonly readCursorBehavior: 'latestVisibleMessage' | 'conversationOpenFallback';
  readonly pagingWindow: MessagingPagingWindow;
  readonly mockSendFailure?: MessageFailureCode;
  readonly realtimeDegraded?: boolean;
}
