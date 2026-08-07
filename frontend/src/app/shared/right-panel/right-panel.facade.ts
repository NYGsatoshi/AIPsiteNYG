import { HttpClient } from '@angular/common/http';
import { computed, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { NotificationOpenContextService } from '../../core/notifications/notification-open-context.service';

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
  'taskDeadlineDigest',
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
  readonly stateVersion?: unknown;
}

interface NotificationOpenDto {
  readonly outcome?: unknown;
  readonly route?: unknown;
  readonly stateVersion?: unknown;
  readonly context?: unknown;
}

export function isSupportedNotificationTarget(target: NotificationTargetType): boolean {
  return SUPPORTED_TARGETS.has(target);
}

export function mapNotificationRoute(
  target: Pick<RightPanelNotification['target'], 'type' | 'id'>,
  scope: RightPanelScope = EMPTY_RIGHT_PANEL_SCOPE,
): string | undefined {
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
      // Task and digest navigation is authorized only by the backend open
      // response. A persisted TargetRoute or a task ID is never a fallback.
      return undefined;
  }
}

export function clampRightPanelText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

@Injectable({ providedIn: 'root' })
export class RightPanelFacade {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeFacade);
  private readonly router = inject(Router, { optional: true });
  private readonly notificationOpenContext = inject(NotificationOpenContextService);
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
  private readonly notificationOpenInProgressState = signal(false);
  private readonly unavailableMessageState = signal<string | null>(null);
  private notificationStateVersion = 0;
  private notificationRefreshInFlight: Promise<void> | null = null;
  private notificationRefreshQueued = false;
  private notificationRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly realtimeEvents: Subscription;

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
      notificationOpenInProgress: this.notificationOpenInProgressState(),
      unavailableMessage: this.unavailableMessageState(),
      realtimeDegraded: this.realtime.connectionState() !== 'Connected',
    };
  });

  constructor() {
    this.realtimeEvents = this.realtime.durableEvents$.subscribe((event) => this.applyRealtimeEvent(event));
    this.realtime.registerCatchUp('right-panel-notifications', () => this.refreshNotifications());
    this.realtime.registerProtectedStateClearer?.('right-panel-notifications', () => this.clearProtectedNotificationState());
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

  /** HTTP remains authoritative when the realtime transport is degraded. */
  refreshNotificationsNow(): void {
    this.unavailableMessageState.set(null);
    void this.refreshNotifications();
  }

  displayNotificationTarget(notificationId: string): void {
    const notification = this.notificationState().find((item) => item.id === notificationId);
    if (!notification || !isSupportedNotificationTarget(notification.target.type)) {
      this.showUnavailable();
      return;
    }

    this.selectedNotificationIdState.set(notificationId);
    this.unavailableMessageState.set(null);
    if (this.mockState) {
      // Story/test data intentionally has no server authority. Do not invent
      // a route or optimistic read state for a mocked notification.
      return;
    }

    this.notificationOpenInProgressState.set(true);
    this.http
      .post<NotificationOpenDto>(`/api/notifications/${notificationId}/open`, {}, { withCredentials: true })
      .subscribe({
        next: (response) => this.applyNotificationOpenResult(notificationId, response),
        error: () => this.showUnavailable(),
        complete: () => this.notificationOpenInProgressState.set(false),
      });
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
    this.notificationOpenInProgressState.set(false);
    this.unavailableMessageState.set(null);
    this.notificationStateVersion = 0;
    this.notificationState.set([]);
  }

  private loadNotifications(): void {
    void this.refreshNotifications();
  }

  private toNotification(item: NotificationDto): RightPanelNotification {
    const targetType = notificationTargetType(item.relatedEntityType, item.notificationType);
    const target = {
      type: targetType,
      id: stringValue(item.relatedEntityId),
      label: targetType === 'taskDeadlineDigest' ? 'Task deadline digest' : targetType,
      route: undefined,
    };

    return {
      id: stringValue(item.id) ?? '',
      scope: EMPTY_RIGHT_PANEL_SCOPE,
      title: stringValue(item.title) ?? 'Notification',
      body: stringValue(item.body) ?? '',
      target,
      read: item.isRead === true,
      stateVersion: numericValue(item.stateVersion),
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

  private applyRealtimeEvent(event: DurableRealtimeEvent): void {
    if (event.eventType === 'Notifications.NotificationCreated.v1') {
      this.applyNotificationCreated(event);
      return;
    }

    if (event.eventType === 'Notifications.NotificationReadStateChanged.v1') {
      this.applyNotificationReadState(event);
    }
  }

  private applyNotificationCreated(event: DurableRealtimeEvent): void {
    const payload = event.payload;
    const notification = payload['notification'];
    const stateVersion = numericValue(payload['stateVersion']) ?? numericValue(recordValue(notification)['version']) ?? event.aggregateVersion ?? 0;
    const requiresRefetch = payload['requiresRefetch'] === true;
    if (stateVersion <= this.notificationStateVersion) {
      return;
    }

    // Task and digest signals are reference-only. Never derive display data,
    // a route, or recipient relationship state from a durable event.
    if (requiresRefetch || !notification) {
      this.queueNotificationRefresh();
      return;
    }

    const mapped = this.toNotification(recordValue(notification));
    if (!mapped.id) {
      this.queueNotificationRefresh();
      return;
    }

    const uncertainOrdering = this.notificationStateVersion > 0 && stateVersion > this.notificationStateVersion + 1;
    this.notificationState.update((items) => [
      { ...mapped, stateVersion },
      ...items.filter((item) => item.id !== mapped.id),
    ]);
    this.notificationStateVersion = stateVersion;
    if (uncertainOrdering) {
      this.queueNotificationRefresh();
    }
  }

  private applyNotificationReadState(event: DurableRealtimeEvent): void {
    const payload = event.payload;
    const stateVersion = numericValue(payload['stateVersion']) ?? event.aggregateVersion ?? 0;
    if (stateVersion <= this.notificationStateVersion) {
      return;
    }

    const notificationId = stringValue(payload['notificationId']);
    const change = stringValue(payload['change']);
    const uncertainOrdering = this.notificationStateVersion > 0 && stateVersion > this.notificationStateVersion + 1;
    this.notificationState.update((items) => {
      if (change === 'deleted' && notificationId) {
        return items.filter((item) => item.id !== notificationId);
      }
      if (change === 'allRead') {
        return items.map((item) => ({ ...item, read: true, stateVersion }));
      }
      if (change === 'read' && notificationId) {
        return items.map((item) => item.id === notificationId ? { ...item, read: true, stateVersion } : item);
      }
      return items;
    });
    this.notificationStateVersion = stateVersion;
    if (uncertainOrdering || !change) {
      this.queueNotificationRefresh();
    }
  }

  private clearProtectedNotificationState(): void {
    this.notificationStateVersion = 0;
    this.selectedNotificationIdState.set(null);
    this.notificationOpenInProgressState.set(false);
    this.unavailableMessageState.set(null);
    this.notificationState.set([]);
  }

  private refreshNotifications(): Promise<void> {
    if (this.mockState) {
      return Promise.resolve();
    }
    if (this.notificationRefreshInFlight) {
      this.notificationRefreshQueued = true;
      return this.notificationRefreshInFlight;
    }
    if (this.notificationRefreshTimer !== null) {
      clearTimeout(this.notificationRefreshTimer);
      this.notificationRefreshTimer = null;
    }

    this.notificationRefreshInFlight = new Promise<void>((resolve) => {
      this.http
        .get<PagedResponseDto<NotificationDto>>('/api/notifications', { withCredentials: true })
        .subscribe({
          next: (response) => {
            this.notificationState.set(this.normalizeNotifications((response.items ?? []).map((item) => this.toNotification(item))));
            this.notificationStateVersion = Math.max(...this.notificationState().map((item) => item.stateVersion ?? 0), 0);
            resolve();
          },
          error: (error: { status?: number }) => {
            if (error.status === 401 || error.status === 403) {
              this.permissionState.set('denied');
              this.notificationState.set([]);
            }
            resolve();
          },
        });
    }).finally(() => {
      this.notificationRefreshInFlight = null;
      if (this.notificationRefreshQueued) {
        this.notificationRefreshQueued = false;
        this.queueNotificationRefresh();
      }
    });
    return this.notificationRefreshInFlight;
  }

  private queueNotificationRefresh(): void {
    if (this.mockState) return;
    if (this.notificationRefreshInFlight) {
      this.notificationRefreshQueued = true;
      return;
    }
    if (this.notificationRefreshTimer !== null) return;
    this.notificationRefreshTimer = setTimeout(() => {
      this.notificationRefreshTimer = null;
      void this.refreshNotifications();
    }, 75);
  }

  private applyNotificationOpenResult(notificationId: string, response: NotificationOpenDto): void {
    const outcome = stringValue(response.outcome);
    const route = stringValue(response.route);
    const stateVersion = numericValue(response.stateVersion) ?? 0;
    if (outcome !== 'Opened' || !route || !isAuthorizedOpenRoute(route)) {
      this.showUnavailable();
      return;
    }

    // An open result may update read state only after the server authorized
    // the target. Older versions never overwrite a newer local projection.
    if (stateVersion > this.notificationStateVersion) {
      this.notificationState.update((items) =>
        items.map((item) => item.id === notificationId ? { ...item, read: true, stateVersion } : item),
      );
      this.notificationStateVersion = stateVersion;
    } else if (stateVersion < this.notificationStateVersion) {
      this.queueNotificationRefresh();
    }

    if (route === '/tasks') {
      const workspaceId = workspaceIdFromOpenContext(response.context);
      if (!workspaceId) {
        this.showUnavailable();
        return;
      }
      this.notificationOpenContext.setDigestWorkspace(workspaceId);
    }
    if (!this.router) {
      this.showUnavailable();
      return;
    }
    void this.router.navigateByUrl(route).catch(() => this.showUnavailable());
  }

  private showUnavailable(): void {
    this.notificationOpenInProgressState.set(false);
    this.unavailableMessageState.set('This notification target is no longer available.');
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

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
  if (normalized.includes('deadline') || normalized.includes('digest')) {
    return 'taskDeadlineDigest';
  }
  if (normalized.includes('task')) {
    return 'task';
  }
  return 'unsupported';
}

function isTaskDetailRoute(route: string): boolean {
  return /^\/projects\/[^/]+\/tasks\/[^/]+$/.test(route);
}

function isAuthorizedOpenRoute(route: string): boolean {
  return route === '/tasks' || isTaskDetailRoute(route);
}

function workspaceIdFromOpenContext(value: unknown): string | undefined {
  return stringValue(recordValue(value)['workspaceId']);
}
