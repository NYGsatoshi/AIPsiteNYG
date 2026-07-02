import { computed, Injectable, InjectionToken, inject, signal } from '@angular/core';

import {
  DEFAULT_RIGHT_PANEL_SCOPE,
  RIGHT_PANEL_MEMBERS,
  RIGHT_PANEL_NOTIFICATIONS
} from './right-panel.mock';
import {
  NotificationTargetType,
  RightPanelMember,
  RightPanelMockState,
  RightPanelMode,
  RightPanelNotification,
  RightPanelPermission,
  RightPanelScope,
  RightPanelTab,
  RightPanelViewModel
} from './right-panel.types';

const RIGHT_PANEL_STORAGE_KEY = 'aipsite.rightPanel.mode';
const SUPPORTED_TARGETS = new Set<NotificationTargetType>([
  'announcement',
  'channelConversation',
  'dmConversation',
  'project',
  'task'
]);

export const AIP_RIGHT_PANEL_MOCK = new InjectionToken<RightPanelMockState>('AIP_RIGHT_PANEL_MOCK');

export function isSupportedNotificationTarget(target: NotificationTargetType): boolean {
  return SUPPORTED_TARGETS.has(target);
}

export function clampRightPanelText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

@Injectable({ providedIn: 'root' })
export class RightPanelFacade {
  private readonly mockState = inject(AIP_RIGHT_PANEL_MOCK, { optional: true });
  private readonly modeState = signal<RightPanelMode>(this.mockState?.mode ?? this.readStoredMode());
  private readonly selectedTabState = signal<RightPanelTab>(this.mockState?.selectedTab ?? 'notifications');
  private readonly permissionState = signal<RightPanelPermission>(this.mockState?.permission ?? 'granted');
  private readonly scopeState = signal<RightPanelScope>(this.mockState?.activeScope ?? DEFAULT_RIGHT_PANEL_SCOPE);
  private readonly notificationState = signal<readonly RightPanelNotification[]>(
    this.normalizeNotifications(this.mockState?.notifications ?? RIGHT_PANEL_NOTIFICATIONS)
  );
  private readonly memberState = signal<readonly RightPanelMember[]>(this.mockState?.members ?? RIGHT_PANEL_MEMBERS);
  private readonly selectedNotificationIdState = signal<string | null>(null);

  readonly mode = this.modeState.asReadonly();
  readonly selectedTab = this.selectedTabState.asReadonly();
  readonly activeScope = this.scopeState.asReadonly();

  readonly viewModel = computed<RightPanelViewModel>(() => {
    const scope = this.scopeState();
    const notifications = this.notificationState().filter((notification) => this.inScope(notification.scope, scope));
    const members = this.memberState().filter((member) => this.inScope(member.scope, scope));

    return {
      mode: this.modeState(),
      selectedTab: this.selectedTabState(),
      permission: this.permissionState(),
      scope,
      notifications,
      unreadCount: notifications.filter((notification) => !notification.read).length,
      members,
      selectedNotificationId: this.selectedNotificationIdState()
    };
  });

  setMode(mode: RightPanelMode): void {
    this.modeState.set(mode);
    if (mode === 'expanded' || mode === 'collapsed') {
      this.writeStoredMode(mode);
    }
  }

  togglePanel(): void {
    this.setMode(this.modeState() === 'collapsed' ? 'expanded' : 'collapsed');
  }

  openDrawer(): void {
    this.setMode('drawer');
  }

  closePanel(): void {
    this.setMode('collapsed');
  }

  setSelectedTab(tab: RightPanelTab): void {
    this.selectedTabState.set(tab);
  }

  setPermission(permission: RightPanelPermission): void {
    this.permissionState.set(permission);
  }

  setActiveScope(scope: RightPanelScope): void {
    this.scopeState.set(scope);
  }

  displayNotificationTarget(notificationId: string): boolean {
    const notification = this.notificationState().find((item) => item.id === notificationId);
    if (!notification || !isSupportedNotificationTarget(notification.target.type)) {
      return false;
    }

    this.selectedNotificationIdState.set(notificationId);
    this.markNotificationRead(notificationId);
    return true;
  }

  markNotificationRead(notificationId: string): void {
    this.notificationState.update((notifications) =>
      notifications.map((notification) =>
        notification.id === notificationId ? { ...notification, read: true } : notification
      )
    );
  }

  clearPanelState(): void {
    this.removeStoredMode();
    this.modeState.set('collapsed');
    this.selectedTabState.set('notifications');
    this.permissionState.set(this.mockState?.permission ?? 'granted');
    this.scopeState.set(this.mockState?.activeScope ?? DEFAULT_RIGHT_PANEL_SCOPE);
    this.selectedNotificationIdState.set(null);
  }

  private normalizeNotifications(notifications: readonly RightPanelNotification[]): readonly RightPanelNotification[] {
    return notifications.map((notification) => ({
      ...notification,
      title: clampRightPanelText(notification.title, 80),
      body: clampRightPanelText(notification.body, 160)
    }));
  }

  private inScope(recordScope: RightPanelScope, activeScope: RightPanelScope): boolean {
    return (
      recordScope.workspaceId === activeScope.workspaceId &&
      recordScope.projectId === activeScope.projectId &&
      recordScope.conversationId === activeScope.conversationId
    );
  }

  private readStoredMode(): RightPanelMode {
    try {
      const stored = globalThis.sessionStorage?.getItem(RIGHT_PANEL_STORAGE_KEY);
      return stored === 'expanded' ? 'expanded' : 'collapsed';
    } catch {
      return 'collapsed';
    }
  }

  private writeStoredMode(mode: 'collapsed' | 'expanded'): void {
    try {
      globalThis.sessionStorage?.setItem(RIGHT_PANEL_STORAGE_KEY, mode);
    } catch {
      // Storage can be unavailable in hardened browsers or tests.
    }
  }

  private removeStoredMode(): void {
    try {
      globalThis.sessionStorage?.removeItem(RIGHT_PANEL_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in hardened browsers or tests.
    }
  }
}
