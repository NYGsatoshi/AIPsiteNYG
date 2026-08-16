export type RightPanelTab = 'notifications' | 'members';

export type RightPanelMode = 'collapsed' | 'expanded' | 'drawer';

export type RightPanelPermission = 'granted' | 'denied';

export type AccountStatusLabel = '参加中' | '利用停止' | '削除済み';

export type AvailabilityLabel = 'オンライン' | 'オフライン' | '退席中' | '応答不可';

export type NotificationTargetType =
  | 'announcement'
  | 'channelConversation'
  | 'dmConversation'
  | 'project'
  | 'task'
  | 'taskDeadlineDigest'
  | 'artifact'
  | 'message'
  | 'unsupported';

export interface RightPanelScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly conversationId: string;
}

export interface RightPanelMember {
  readonly id: string;
  readonly scope: RightPanelScope;
  readonly displayName: string;
  readonly role: string;
  readonly groupLabel: string;
  readonly accountStatus: AccountStatusLabel;
  readonly availability?: AvailabilityLabel;
}

export interface RightPanelNotificationTarget {
  readonly type: NotificationTargetType;
  readonly id?: string;
  readonly label: string;
  readonly route?: string;
}

export interface RightPanelNotification {
  readonly id: string;
  readonly scope: RightPanelScope;
  readonly title: string;
  readonly body: string;
  readonly target: RightPanelNotificationTarget;
  readonly read: boolean;
  readonly stateVersion?: number;
}

export interface RightPanelViewModel {
  readonly mode: RightPanelMode;
  readonly selectedTab: RightPanelTab;
  readonly permission: RightPanelPermission;
  readonly scope: RightPanelScope;
  readonly notifications: readonly RightPanelNotification[];
  readonly unreadCount: number;
  readonly members: readonly RightPanelMember[];
  readonly selectedNotificationId: string | null;
  readonly notificationOpenInProgress: boolean;
  readonly unavailableMessage: string | null;
  readonly realtimeDegraded: boolean;
}

export interface RightPanelMockState {
  readonly mode?: RightPanelMode;
  readonly selectedTab?: RightPanelTab;
  readonly permission?: RightPanelPermission;
  readonly activeScope?: RightPanelScope;
  readonly notifications?: readonly RightPanelNotification[];
  readonly members?: readonly RightPanelMember[];
}
