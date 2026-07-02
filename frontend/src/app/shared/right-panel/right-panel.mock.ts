import {
  RightPanelMember,
  RightPanelNotification,
  RightPanelScope
} from './right-panel.types';

export const DEFAULT_RIGHT_PANEL_SCOPE: RightPanelScope = {
  workspaceId: 'fictional-workspace-1',
  projectId: 'fictional-project-a',
  conversationId: 'fictional-conversation-main'
};

export const OTHER_RIGHT_PANEL_SCOPE: RightPanelScope = {
  workspaceId: 'fictional-workspace-2',
  projectId: 'fictional-project-b',
  conversationId: 'fictional-conversation-other'
};

export const RIGHT_PANEL_MEMBERS: readonly RightPanelMember[] = [
  {
    id: 'member-a',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    displayName: 'サンプル参加者A',
    role: 'プロジェクト管理',
    groupLabel: '教材計画',
    accountStatus: '参加中',
    availability: 'オンライン'
  },
  {
    id: 'member-b',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    displayName: 'サンプル参加者B',
    role: 'レビュー担当',
    groupLabel: '教材計画',
    accountStatus: '参加中',
    availability: '退席中'
  },
  {
    id: 'member-c',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    displayName: 'サンプル参加者C',
    role: '閲覧',
    groupLabel: '共有チャンネル',
    accountStatus: '利用停止',
    availability: 'オフライン'
  },
  {
    id: 'member-other-scope',
    scope: OTHER_RIGHT_PANEL_SCOPE,
    displayName: '別スコープ参加者',
    role: '管理',
    groupLabel: '別プロジェクト',
    accountStatus: '参加中',
    availability: '応答不可'
  }
];

export const RIGHT_PANEL_NOTIFICATIONS: readonly RightPanelNotification[] = [
  {
    id: 'notification-announcement',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    title: 'お知らせが更新されました',
    body: '教材計画に関する共有事項があります。内容を確認してください。',
    target: {
      type: 'announcement',
      id: 'announcement-101',
      label: 'お知らせ'
    },
    read: false
  },
  {
    id: 'notification-channel',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    title: 'チャンネル会話で確認依頼があります',
    body: '本文プレビューではなく、安全な通知文だけを表示しています。',
    target: {
      type: 'channelConversation',
      id: 'channel-201',
      label: 'チャンネル'
    },
    read: false
  },
  {
    id: 'notification-dm',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    title: 'DM会話に更新があります',
    body: '参加者向けの会話が更新されました。本文のプレビューは表示しません。',
    target: {
      type: 'dmConversation',
      id: 'dm-301',
      label: 'DM'
    },
    read: true
  },
  {
    id: 'notification-project',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    title: 'プロジェクト詳細が更新されました',
    body: '担当範囲と期限の安全な概要だけを表示しています。',
    target: {
      type: 'project',
      id: 'project-401',
      label: 'プロジェクト'
    },
    read: true
  },
  {
    id: 'notification-task',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    title: 'タスクに確認事項があります',
    body: '提出前の確認項目が追加されました。',
    target: {
      type: 'task',
      id: 'task-501',
      label: 'タスク'
    },
    read: false
  },
  {
    id: 'notification-unsupported',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    title: '未対応の通知種別です',
    body: '安全なタイトルと本文のみを表示します。リンクは提供しません。',
    target: {
      type: 'unsupported',
      id: 'legacy-target-601',
      label: '未対応'
    },
    read: false
  },
  {
    id: 'notification-html-body',
    scope: DEFAULT_RIGHT_PANEL_SCOPE,
    title: '本文はHTMLとして解釈しません',
    body: '<strong>強調タグ</strong> は文字列として表示されます。',
    target: {
      type: 'announcement',
      id: 'announcement-102',
      label: 'お知らせ'
    },
    read: false
  },
  {
    id: 'notification-other-scope',
    scope: OTHER_RIGHT_PANEL_SCOPE,
    title: '別スコープの通知',
    body: 'この通知は現在の右パネルには表示されません。',
    target: {
      type: 'project',
      id: 'project-999',
      label: '別プロジェクト'
    },
    read: false
  }
];
