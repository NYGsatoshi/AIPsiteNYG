import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

import { AuthSessionFacade } from '../auth/auth-session.facade';
import { FrontendFeatureFlagsService } from '../feature-flags/frontend-feature-flags.service';
import { NotificationOpenContextService } from '../notifications/notification-open-context.service';
import { ActiveWorkspaceFacade } from '../workspace/active-workspace.facade';
import { validateDurableRealtimeEvent } from './realtime-event.validator';
import {
  DurableRealtimeEvent,
  RealtimeConnectionState,
  RealtimeDiagnostic,
  RealtimeSubscriptionRequest,
  RealtimeSubscriptionResult
} from './realtime.models';
import { AIP_REALTIME_TRANSPORT, RealtimeTransport, RealtimeTransportStatus } from './realtime-transport';
import { SignalrRealtimeTransport } from './signalr-realtime.transport';

export interface RealtimeCatchUpContext {
  readonly deniedOwners: ReadonlySet<string>;
}

export type RealtimeCatchUpCallback = (context: RealtimeCatchUpContext) => Promise<void> | void;
export type RealtimeStaleEventGuard = (event: DurableRealtimeEvent) => boolean;

interface SubscriptionEntry {
  readonly request: RealtimeSubscriptionRequest;
  readonly owners: Set<string>;
}

const CORE_OWNER = 'core-session';
const MAX_DEDUP_EVENTS = 256;

/**
 * AIPsite-owned boundary for the one internal SignalR connection. Feature
 * facades register logical resource subscriptions and authoritative catch-up
 * callbacks here; they never receive HubConnection callbacks.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeFacade {
  private readonly authSession = inject(AuthSessionFacade);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly notificationOpenContext = inject(NotificationOpenContextService);
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly transport = inject(AIP_REALTIME_TRANSPORT, { optional: true }) ?? inject(SignalrRealtimeTransport);
  private readonly state = signal<RealtimeConnectionState>('Degraded');
  private readonly events = new Subject<DurableRealtimeEvent>();
  private readonly diagnosticsSubject = new Subject<RealtimeDiagnostic>();
  // Feature registrations are declarative intent. They survive a transient
  // authorization loss so a later reconnect can ask the server again. The
  // separate set represents only groups authorized on the current transport.
  private readonly desiredSubscriptions = new Map<string, SubscriptionEntry>();
  private readonly authorizedSubscriptionKeys = new Set<string>();
  private readonly catchUps = new Map<string, RealtimeCatchUpCallback>();
  private readonly staleGuards = new Map<string, RealtimeStaleEventGuard>();
  private readonly protectedStateClearers = new Map<string, () => void>();
  private readonly dedup = new Map<string, number>();
  private readonly aggregateVersions = new Map<string, number>();
  private tenantId: string | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private intentionallyStopped = false;

  readonly connectionState = this.state.asReadonly();
  readonly isEnabled = this.flags.realtimeSignalREnabled;
  readonly isSynchronized = computed(() => this.state() === 'Connected');
  readonly durableEvents$ = this.events.asObservable();
  readonly diagnostics$ = this.diagnosticsSubject.asObservable();

  constructor() {
    this.transport.durableEvents$.subscribe((event) => this.processEvent(event));
    this.transport.authorizationInvalidations$.subscribe(() => this.clearForAuthorizationLoss());
    this.transport.statuses$.subscribe((status) => this.handleTransportStatus(status));

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', () => {
        if (!this.intentionallyStopped) {
          this.state.set('Offline');
        }
      });
      window.addEventListener('online', () => {
        if (!this.intentionallyStopped && this.canConnect()) {
          void this.connectAndSynchronize();
        }
      });
    }

    effect(() => {
      const tenant = this.authSession.currentTenant();
      const authenticated = this.authSession.isAuthenticated();
      const enabled = this.flags.realtimeSignalREnabled();
      if (!authenticated) {
        this.stopForSessionBoundary();
        return;
      }

      // AuthSession hydrates the authenticated user (and its canonical current
      // Workspace) before /api/tenants/current completes. That short-lived
      // tenant-null state is not a logout, Tenant switch, or authorization
      // invalidation, so it must not clear protected HTTP-owned state.
      if (!tenant) {
        this.stopRealtimeTransportOnly();
        return;
      }

      if (!tenant.isAvailable) {
        this.stopForSessionBoundary();
        return;
      }

      if (this.tenantId && this.tenantId !== tenant.tenantId) {
        this.clearForTenantBoundary();
      }
      this.tenantId = tenant.tenantId;

      // The rollout flag controls only the SignalR transport. HTTP remains
      // authoritative and its valid feature state is not a session, tenant,
      // or authorization boundary.
      if (!enabled) {
        this.stopRealtimeTransportOnly();
        return;
      }

      void this.connectAndSynchronize();
    });
  }

  registerSubscription(owner: string, request: RealtimeSubscriptionRequest): () => void {
    validateSubscription(request);
    const key = subscriptionKey(request);
    const existing = this.desiredSubscriptions.get(key);
    if (existing) {
      existing.owners.add(owner);
    } else {
      this.desiredSubscriptions.set(key, { request, owners: new Set([owner]) });
    }

    if (this.isSynchronized()) {
      void this.authorizeSubscription(request);
    }
    return () => this.removeSubscription(owner, request);
  }

  registerCatchUp(owner: string, callback: RealtimeCatchUpCallback): () => void {
    this.catchUps.set(owner, callback);
    return () => this.catchUps.delete(owner);
  }

  registerStaleEventGuard(owner: string, guard: RealtimeStaleEventGuard): () => void {
    this.staleGuards.set(owner, guard);
    return () => this.staleGuards.delete(owner);
  }

  /**
   * Registers a feature-owned clear operation. Authorization loss is handled
   * before transport reauthorization/catch-up, so no protected projection is
   * left visible while an old SignalR group is being replaced.
   */
  registerProtectedStateClearer(owner: string, clear: () => void): () => void {
    this.protectedStateClearers.set(owner, clear);
    return () => this.protectedStateClearers.delete(owner);
  }

  /** Called by session/tenant lifecycle owners before protected state changes. */
  clearForTenantBoundary(): void {
    // A new Tenant must never inherit Workspace/context/subscription state
    // from the old Tenant. This is distinct from a temporary authorization
    // invalidation, which preserves declarative subscription intent.
    this.clearTenantBoundaryState();
    this.intentionallyStopped = true;
    void this.stopTransport();
    this.state.set('Degraded');
  }

  clearForAuthorizationLoss(): void {
    // Keep declarative subscription intents so a reconnect explicitly
    // reauthorizes each one. Clearing only the map would make a lost group
    // silently disappear without a current HTTP/catch-up decision.
    this.clearAuthorizationInvalidationState();
    this.state.set('Reconnecting');
    this.intentionallyStopped = true;
    void this.stopTransport().then(async () => {
      await this.refreshSessionAfterConnectionFailure();
      if (!this.canConnect()) {
        this.state.set('Degraded');
        return;
      }

      this.intentionallyStopped = false;
      await this.connectAndSynchronize();
    });
  }

  private async connectAndSynchronize(): Promise<void> {
    if (this.starting || this.isSynchronized() || !this.canConnect()) {
      return this.starting ?? Promise.resolve();
    }

    this.intentionallyStopped = false;
    this.starting = this.beginSynchronization().finally(() => (this.starting = null));
    return this.starting;
  }

  private async beginSynchronization(): Promise<void> {
    try {
      if (this.stopping) {
        await this.stopping;
      }
      if (!this.canConnect()) {
        return;
      }
      await this.transport.start();
      if (!this.canConnect()) {
        return;
      }

      const currentUserResult = await this.authorizeSubscription({ subscriptionType: 'user' });
      if (!currentUserResult.allowed) {
        this.clearForAuthorizationLoss();
        return;
      }

      const deniedOwners = new Set<string>();
      for (const entry of [...this.desiredSubscriptions.values()]) {
        if (entry.request.subscriptionType !== 'user') {
          const result = await this.authorizeSubscription(entry.request);
          if (!result.allowed) {
            for (const owner of entry.owners)
              deniedOwners.add(owner);
          }
        }
      }

      await this.runCatchUps({ deniedOwners });
      if (this.canConnect()) {
        this.state.set('Connected');
      }
    } catch {
      this.diagnosticsSubject.next({ code: 'ConnectionFailed' });
      await this.refreshSessionAfterConnectionFailure();
      this.state.set(this.httpIsLikelyAvailable() ? 'Degraded' : 'Offline');
    }
  }

  private async authorizeSubscription(request: RealtimeSubscriptionRequest): Promise<RealtimeSubscriptionResult> {
    const result = await this.transport.subscribe(request);
    const key = subscriptionKey(request);
    if (!result.allowed) {
      this.diagnosticsSubject.next({ code: 'SubscriptionDenied' });
      // A denial revokes only the current transport group. The feature owner
      // still exists and must be reauthorized on a later reconnect.
      this.authorizedSubscriptionKeys.delete(key);
    } else {
      this.authorizedSubscriptionKeys.add(key);
    }
    return result;
  }

  private async runCatchUps(context: RealtimeCatchUpContext): Promise<void> {
    let failed = false;
    // Registration order is the feature-defined authoritative reconciliation order.
    // Every callback must observe a denied owner even when an unrelated HTTP
    // reconciliation fails first, so one feature cannot prevent another from
    // clearing protected state.
    for (const callback of [...this.catchUps.values()]) {
      try {
        await callback(context);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      this.diagnosticsSubject.next({ code: 'CatchUpFailed' });
      throw new Error('Realtime catch-up could not complete.');
    }
  }

  private processEvent(value: unknown): void {
    const tenantId = this.tenantId;
    if (!tenantId) {
      return;
    }

    const event = validateDurableRealtimeEvent(value, tenantId);
    if (!event) {
      this.diagnosticsSubject.next({ code: 'UnsupportedEvent' });
      return;
    }
    if (this.isDuplicate(event.eventId)) {
      this.diagnosticsSubject.next({ code: 'DuplicateEvent', eventId: event.eventId, eventType: event.eventType });
      return;
    }
    if (this.isStale(event)) {
      this.diagnosticsSubject.next({ code: 'StaleEvent', eventId: event.eventId, eventType: event.eventType });
      return;
    }

    if (event.eventType === 'Security.AuthorizationStateChanged.v1') {
      this.clearForAuthorizationLoss();
      return;
    }
    this.events.next(event);
  }

  private isDuplicate(eventId: string): boolean {
    if (this.dedup.has(eventId)) {
      return true;
    }
    this.dedup.set(eventId, Date.now());
    if (this.dedup.size > MAX_DEDUP_EVENTS) {
      this.dedup.delete(this.dedup.keys().next().value as string);
    }
    return false;
  }

  private isStale(event: DurableRealtimeEvent): boolean {
    if ([...this.staleGuards.values()].some((guard) => !guard(event))) {
      return true;
    }
    if (event.aggregateVersion === null) {
      return false;
    }

    const key = `${event.aggregateType}:${event.aggregateId}`;
    const currentVersion = this.aggregateVersions.get(key);
    if (currentVersion !== undefined && event.aggregateVersion <= currentVersion) {
      return true;
    }
    this.aggregateVersions.set(key, event.aggregateVersion);
    return false;
  }

  private removeSubscription(owner: string, request: RealtimeSubscriptionRequest): void {
    const key = subscriptionKey(request);
    const entry = this.desiredSubscriptions.get(key);
    if (!entry) {
      return;
    }
    entry.owners.delete(owner);
    if (entry.owners.size > 0) {
      return;
    }
    this.desiredSubscriptions.delete(key);
    if (this.isSynchronized() &&
        this.authorizedSubscriptionKeys.delete(key) &&
        request.subscriptionType !== 'user' &&
        request.subscriptionType !== 'tenant') {
      void this.transport.unsubscribe(request);
    }
  }

  private handleTransportStatus(status: RealtimeTransportStatus): void {
    if (this.intentionallyStopped) {
      return;
    }
    if (status === 'reconnecting' || status === 'connecting') {
      this.authorizedSubscriptionKeys.clear();
      this.state.set('Reconnecting');
      return;
    }
    if (status === 'reconnected') {
      this.authorizedSubscriptionKeys.clear();
      this.state.set('Reconnecting');
      void this.connectAndSynchronize();
      return;
    }
    if (status === 'closed') {
      this.authorizedSubscriptionKeys.clear();
      this.state.set(this.httpIsLikelyAvailable() ? 'Degraded' : 'Offline');
    }
  }

  private clearProtectedApplicationState(): void {
    this.activeWorkspace.clearWorkspace();
    this.notificationOpenContext.clear();
    for (const [owner, clear] of [...this.protectedStateClearers.entries()]) {
      try {
        // This can run from the root authorization effect. Feature clearers
        // commonly read and replace their own signals, which must not become
        // dependencies of that effect or re-enter a terminal clear boundary.
        untracked(clear);
      } catch {
        // A feature clear must not block the security boundary for another
        // feature. Its next authoritative catch-up will recover its state.
      }
    }
  }

  private clearTransportAuthorizationState(): void {
    this.authorizedSubscriptionKeys.clear();
    this.dedup.clear();
    this.aggregateVersions.clear();
  }

  private clearSessionBoundaryState(): void {
    this.clearProtectedApplicationState();
    this.desiredSubscriptions.clear();
    this.clearTransportAuthorizationState();
    this.tenantId = null;
  }

  private clearTenantBoundaryState(): void {
    this.clearProtectedApplicationState();
    this.desiredSubscriptions.clear();
    this.clearTransportAuthorizationState();
    this.tenantId = null;
  }

  private clearAuthorizationInvalidationState(): void {
    this.clearProtectedApplicationState();
    this.clearTransportAuthorizationState();
  }

  private stopForSessionBoundary(): void {
    this.clearSessionBoundaryState();
    this.intentionallyStopped = true;
    void this.stopTransport();
    this.state.set('Degraded');
  }

  /**
   * Stops only the unavailable transport. A disabled realtime rollout or the
   * authenticated tenant-hydration interval is not a logout, Tenant change,
   * or authorization revocation, so HTTP-owned application state and
   * declarative subscriptions must remain intact.
   */
  private stopRealtimeTransportOnly(): void {
    this.intentionallyStopped = true;
    this.clearTransportAuthorizationState();
    void this.stopTransport();
    this.state.set('Degraded');
  }

  private canConnect(): boolean {
    return this.flags.realtimeSignalREnabled() && this.authSession.isAuthenticated() && !!this.tenantId;
  }

  private async refreshSessionAfterConnectionFailure(): Promise<void> {
    try {
      await firstValueFrom(this.authSession.refreshSessionContext());
    } catch {
      // HTTP remains the authority; a failed probe simply preserves degraded mode.
    }
  }

  private async stopTransport(): Promise<void> {
    if (this.stopping) {
      return this.stopping;
    }

    const stop = this.transport.stop().catch(() => undefined);
    this.stopping = stop;
    try {
      await stop;
    } finally {
      if (this.stopping === stop) {
        this.stopping = null;
      }
    }
  }

  private httpIsLikelyAvailable(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine;
  }
}

function validateSubscription(request: RealtimeSubscriptionRequest): void {
  const requiresResource = request.subscriptionType === 'workspace' || request.subscriptionType === 'conversation' || request.subscriptionType === 'project';
  if (requiresResource && !request.resourceId) {
    throw new Error(`Realtime ${request.subscriptionType} subscription requires an opaque resource ID.`);
  }
  if ((request.subscriptionType === 'user' || request.subscriptionType === 'tenant') && request.resourceId) {
    throw new Error(`Realtime ${request.subscriptionType} subscription is server-derived and does not accept a resource ID.`);
  }
}

function subscriptionKey(request: RealtimeSubscriptionRequest): string {
  return `${request.subscriptionType}:${request.resourceId ?? 'server-derived'}`;
}
