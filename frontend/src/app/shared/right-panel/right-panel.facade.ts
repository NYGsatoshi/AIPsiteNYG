import { HttpClient } from '@angular/common/http';
import { computed, Injectable, InjectionToken, inject, signal } from '@angular/core';

import {
  NotificationTargetType,
  RightPanelMember,
  RightPanelMockState,
  RightPanelMode,
  RightPanelNotification,
  RightPanelPermission,
  RightPanelScope,
  RightPanelTab,
  RightPanelViewModel,
} from './right-panel.types';

const RIGHT_PANEL_STORAGE_KEY = 'aipsite.rightPanel.mode';
const SUPPORTED_TARGETS = new Set<NotificationTargetType>([
  'announcement',
  'channelConversation',
  'dmConversation',
  'project',
  'task',
]);

export const AIP_RIGHT_PANEL_MOCK = new InjectionToken<RightPanelMockState>('AIP_RIGHT_PANEL_MOCK');

const EMPTY_RIGHT_PANEL_SCOPE: RightPanelScope = {
  workspaceId: '',
  projectId: '',
  conversationId: '',
};

interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

interface NotificationDto {
  readonly id?: unknown;
  readonly notificationType?: unknown;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly relatedEntityType?: unknown;
  readonly relatedEntityId?: unknown;
  readonly isRead?: unknown;
  readonly targetRoute?: unknown;
}

export function isSupportedNotificationTarget(target: NotificationTargetType): boolean {
  return SUPPORTED_TARGETS.has(target);
}

export function mapNotificationRoute(
  target: Pick<RightPanelNotification['target'], 'type' | 'id' | 'route'>,
  scope: RightPanelScope = EMPTY_RIGHT_PANEL_SCOPE,
): string | undefined {
  if (target.route && isKnownSafeRoute(target.route)) {
    return target.route;
  }

  if (!target.id) {
    return undefined;
  }

  switch (target.type) {
    case 'announcement':
      return `/announcements/${target.id}`;
    case 'task':
      return target.route && isTaskDetailRoute(target.route) ? target.route : undefined;
    case 'project':
      return '/projects';
    case 'channelConversation':
      return scope.workspaceId ? `/workspaces/${scope.workspaceId}/channels/${target.id}` : undefined;
    case 'dmConversation':
      return `/dm/${target.id}`;
    default:
      return undefined;
  }
}

export function clampRightPanelText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

@Injectable({ providedIn: 'root' })
export class RightPanelFacade {
  private readonly http = inject(HttpClient);
  private readonly mockState = inject(AIP_RIGHT_PANEL_MOCK, { optional: true });
  private readonly modeState = signal<RightPanelMode>(
    this.mockState?.mode ?? this.readStoredMode(),
  );
  private readonly selectedTabState = signal<RightPanelTab>(
    this.mockState?.selectedTab ?? 'notifications',
  );
  private readonly permissionState = signal<RightPanelPermission>(
    this.mockState?.permission ?? 'granted',
  );
  private readonly scopeState = signal<RightPanelScope>(
    this.mockState?.activeScope ?? EMPTY_RIGHT_PANEL_SCOPE,
  );
  private readonly notificationState = signal<readonly RightPanelNotification[]>(
    this.normalizeNotifications(this.mockState?.notifications ?? []),
  );
  private readonly memberState = signal<readonly RightPanelMember[]>(this.mockState?.members ?? []);
  private readonly selectedNotificationIdState = signal<string | null>(null);

  readonly mode = this.modeState.asReadonly();
  readonly selectedTab = this.selectedTabState.asReadonly();
  readonly activeScope = this.scopeState.asReadonly();

  readonly viewModel = computed<RightPanelViewModel>(() => {
    const scope = this.scopeState();
    const notifications = this.notificationState().filter((notification) =>
      this.inNotificationScope(notification.scope, scope),
    );
    const members = this.memberState().filter((member) => this.inScope(member.scope, scope));

    return {
      mode: this.modeState(),
      selectedTab: this.selectedTabState(),
      permission: this.permissionState(),
      scope,
      notifications,
      unreadCount: notifications.filter((notification) => !notification.read).length,
      members,
      selectedNotificationId: this.selectedNotificationIdState(),
    };
  });

  constructor() {
    if (!this.mockState) {
      this.loadNotifications();
    }
  }

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
    if (!notification?.target.route) {
      return false;
    }

    this.selectedNotificationIdState.set(notificationId);
    this.markNotificationRead(notificationId);
    return true;
  }

  markNotificationRead(notificationId: string): void {
    if (this.mockState) {
      this.confirmNotificationRead(notificationId);
      return;
    }

    this.http
      .patch(`/api/notifications/${notificationId}/read`, {}, { withCredentials: true })
      .subscribe({
        next: () => this.confirmNotificationRead(notificationId),
        error: () => {
          // Keep unread state unchanged unless the backend confirms persistence.
        },
      });
  }

  clearPanelState(): void {
    this.removeStoredMode();
    this.modeState.set('collapsed');
    this.selectedTabState.set('notifications');
    this.permissionState.set(this.mockState?.permission ?? 'granted');
    this.scopeState.set(this.mockState?.activeScope ?? EMPTY_RIGHT_PANEL_SCOPE);
    this.selectedNotificationIdState.set(null);
  }

  private loadNotifications(): void {
    this.http
      .get<PagedResponseDto<NotificationDto>>('/api/notifications', { withCredentials: true })
      .subscribe({
        next: (response) => {
          this.notificationState.set(
            this.normalizeNotifications(
              (response.items ?? []).map((item) => this.toNotification(item)),
            ),
          );
        },
        error: (error: { status?: number }) => {
          if (error.status === 401 || error.status === 403) {
            this.permissionState.set('denied');
          }
          this.notificationState.set([]);
        },
      });
  }

  private toNotification(item: NotificationDto): RightPanelNotification {
    const targetType = notificationTargetType(item.relatedEntityType, item.notificationType);
    const target = {
      type: targetType,
      id: stringValue(item.relatedEntityId),
      label: stringValue(item.targetRoute) ?? targetType,
      route: stringValue(item.targetRoute),
    };

    return {
      id: stringValue(item.id) ?? '',
      scope: EMPTY_RIGHT_PANEL_SCOPE,
      title: stringValue(item.title) ?? 'Notification',
      body: stringValue(item.body) ?? '',
      target,
      read: item.isRead === true,
    };
  }

  private normalizeNotifications(
    notifications: readonly RightPanelNotification[],
  ): readonly RightPanelNotification[] {
    return notifications.map((notification) => {
      const target = {
        ...notification.target,
        route: mapNotificationRoute(notification.target, notification.scope),
      };

      return {
        ...notification,
        target,
        title: clampRightPanelText(notification.title, 80),
        body: clampRightPanelText(notification.body, 160),
      };
    });
  }

  private confirmNotificationRead(notificationId: string): void {
    this.notificationState.update((notifications) =>
      notifications.map((notification) =>
        notification.id === notificationId ? { ...notification, read: true } : notification,
      ),
    );
  }

  private inNotificationScope(recordScope: RightPanelScope, activeScope: RightPanelScope): boolean {
    if (!recordScope.workspaceId && !recordScope.projectId && !recordScope.conversationId) {
      return true;
    }

    return this.inScope(recordScope, activeScope);
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function notificationTargetType(entityType: unknown, notificationType?: unknown): NotificationTargetType {
  const normalized = `${String(entityType ?? '')} ${String(notificationType ?? '')}`.toLowerCase();
  if (normalized.includes('announcement')) {
    return 'announcement';
  }
  if (
    normalized.includes('directmessage') ||
    normalized.includes('dmconversation') ||
    normalized.split(/\s+/).includes('dm')
  ) {
    return 'dmConversation';
  }
  if (normalized.includes('conversation') || normalized.includes('channel')) {
    return 'channelConversation';
  }
  if (normalized.includes('project')) {
    return 'project';
  }
  if (normalized.includes('task')) {
    return 'task';
  }
  return 'unsupported';
}

function isKnownSafeRoute(route: string): boolean {
  return (
    /^\/announcements\/[^/]+$/.test(route) ||
    route === '/projects' ||
    isTaskDetailRoute(route) ||
    /^\/workspaces\/[^/]+\/channels\/[^/]+$/.test(route) ||
    /^\/dm\/[^/]+$/.test(route)
  );
}

function isTaskDetailRoute(route: string): boolean {
  return /^\/projects\/[^/]+\/tasks\/[^/]+$/.test(route);
}
