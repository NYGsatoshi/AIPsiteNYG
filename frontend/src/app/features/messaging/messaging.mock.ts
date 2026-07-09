import { MessagingMessageViewModel, MessagingPageViewModel } from './messaging.types';

export const LONG_MOCK_MESSAGE =
  'これは長文メッセージの表示確認用です。改行や長い語句が混ざっても、本文が枠を壊さず、会話の流れと作成欄を押し出さないことを確認します。'.repeat(8);

export const HIDDEN_DM_BODY = '非参加者に見えてはいけないDM本文';
export const HIDDEN_CHANNEL_BODY = '非参加者に見えてはいけないチャンネル本文';
export const OTHER_USER_PRECISE_READ_TIMESTAMP = '2026-07-02 09:42:31';

const confirmedMessages: readonly MessagingMessageViewModel[] = [
  {
    id: 'msg-001',
    authorLabel: '学習支援担当A',
    authorRoleLabel: 'teacher',
    isOwnMessage: false,
    body: '本日の共有事項をここにまとめます。確認できたら自分の既読だけ反映されます。',
    sentAtLabel: '09:00',
    deliveryState: 'confirmed',
    retryAllowed: false,
    readState: {
      otherReadSummaryLabel: '数名が確認済み',
      otherReadPreciseTimestampLabel: OTHER_USER_PRECISE_READ_TIMESTAMP
    }
  },
  {
    id: 'msg-002',
    authorLabel: '自分',
    authorRoleLabel: 'guardian',
    isOwnMessage: true,
    body: '確認しました。追加の資料が必要なら次回のファイルUIで扱います。',
    sentAtLabel: '09:05',
    deliveryState: 'confirmed',
    retryAllowed: false,
    readState: {
      ownReadLabel: '自分の既読: 最新'
    }
  }
];

const failedMessage: MessagingMessageViewModel = {
  id: 'local-failed-001',
  clientRequestId: 'client-req-failed-001',
  authorLabel: '自分',
  authorRoleLabel: 'guardian',
  isOwnMessage: true,
  body: '送信に失敗したメッセージです。再試行できます。',
  sentAtLabel: '未送信',
  deliveryState: 'failed',
  failureCode: 'network',
  safeFailureReason: '送信できませんでした。接続を確認して再試行してください。',
  retryAllowed: false
};

const baseConversation = {
  id: 'channel-general',
  kind: 'channel' as const,
  tenantId: 'tenant-mock-a',
  workspaceId: 'workspace-mock-a',
  title: '学習連絡チャンネル',
  subtitle: '手動更新で確認する会話',
  viewerIsParticipant: true,
  viewerWasRemoved: false,
  capabilities: ['readBody', 'postMessage', 'viewOwnReadMarker'] as const,
  attachment: {
    mode: 'disabled' as const,
    label: '添付はcanonical file ID境界が完了するまで利用できません'
  }
};

const baseDmConversation = {
  ...baseConversation,
  id: 'dm-support-a',
  kind: 'dm' as const,
  workspaceId: undefined,
  title: 'サポート担当とのDM',
  subtitle: '参加者だけが本文を確認できます'
};

const conversations = [
  {
    id: 'channel-general',
    kind: 'channel' as const,
    title: '学習連絡チャンネル',
    route: '/workspaces/workspace-mock-a/channels/channel-general',
    lastActivityLabel: '09:05',
    safePreviewLabel: '本日の共有事項をここにまとめます。',
    viewerIsParticipant: true,
    unreadCount: 2
  },
  {
    id: 'dm-support-a',
    kind: 'dm' as const,
    title: 'サポート担当とのDM',
    route: '/dm/dm-support-a',
    lastActivityLabel: '08:40',
    safePreviewLabel: 'DMプレビューは参加者ルート内でのみ表示',
    viewerIsParticipant: true
  }
];

export const DEFAULT_CHANNEL_MESSAGING_PAGE: MessagingPageViewModel = {
  routeKind: 'channel',
  status: 'ready',
  title: 'メッセージ',
  conversation: baseConversation,
  conversations,
  messages: confirmedMessages,
  draft: '',
  sending: false,
  sendState: { status: 'idle' },
  hasNewMessagesWhileReading: false,
  readCursorBehavior: 'latestVisibleMessage',
  pagingWindow: {
    visibleMessageIds: confirmedMessages.map((message) => message.id),
    preloadBefore: 20,
    preloadAfter: 20
  }
};

export const DEFAULT_DM_MESSAGING_PAGE: MessagingPageViewModel = {
  ...DEFAULT_CHANNEL_MESSAGING_PAGE,
  routeKind: 'dm',
  conversation: baseDmConversation,
  conversations: [],
  messages: [
    {
      ...confirmedMessages[0],
      id: 'dm-msg-001',
      body: 'DM本文は参加者だけに表示されます。リスト側にはプレビューを出しません。'
    },
    {
      ...confirmedMessages[1],
      id: 'dm-msg-002',
      body: '了解しました。必要な内容だけここで確認します。'
    }
  ]
};

export const MESSAGING_PAGE_SCENARIOS = {
  channelDefault: DEFAULT_CHANNEL_MESSAGING_PAGE,
  dmDefault: DEFAULT_DM_MESSAGING_PAGE,
  noMessages: {
    ...DEFAULT_CHANNEL_MESSAGING_PAGE,
    status: 'empty',
    messages: [],
    pagingWindow: { ...DEFAULT_CHANNEL_MESSAGING_PAGE.pagingWindow, visibleMessageIds: [] }
  },
  composerDisabled: {
    ...DEFAULT_CHANNEL_MESSAGING_PAGE,
    conversation: {
      ...baseConversation,
      capabilities: ['readBody', 'viewOwnReadMarker'],
      composerDisabledReason: 'この会話への投稿権限がありません'
    }
  },
  removedParticipant: {
    ...DEFAULT_CHANNEL_MESSAGING_PAGE,
    status: 'removedParticipant',
    conversation: {
      ...baseConversation,
      viewerIsParticipant: false,
      viewerWasRemoved: true,
      capabilities: [],
      composerDisabledReason: '参加が解除されたため送信できません'
    },
    messages: [{ ...confirmedMessages[0], body: HIDDEN_CHANNEL_BODY }]
  },
  nonParticipantDm: {
    ...DEFAULT_DM_MESSAGING_PAGE,
    status: 'permissionDenied',
    conversation: {
      ...baseDmConversation,
      viewerIsParticipant: false,
      capabilities: []
    },
    messages: [{ ...confirmedMessages[0], body: HIDDEN_DM_BODY }]
  },
  manualRefreshError: {
    ...DEFAULT_CHANNEL_MESSAGING_PAGE,
    status: 'manualRefreshError',
    inlineError: '手動更新に失敗しました。時間をおいて再試行してください。'
  },
  longMessage: {
    ...DEFAULT_CHANNEL_MESSAGING_PAGE,
    messages: [{ ...confirmedMessages[0], id: 'msg-long', body: LONG_MOCK_MESSAGE }]
  },
  failedOutgoingRetry: {
    ...DEFAULT_CHANNEL_MESSAGING_PAGE,
    messages: [...confirmedMessages, failedMessage]
  },
  noAttachmentsUntilCanonicalFileId: DEFAULT_CHANNEL_MESSAGING_PAGE,
  newMessagesWhileReading: {
    ...DEFAULT_CHANNEL_MESSAGING_PAGE,
    hasNewMessagesWhileReading: true
  },
  mobile: DEFAULT_CHANNEL_MESSAGING_PAGE
} satisfies Record<string, MessagingPageViewModel>;
