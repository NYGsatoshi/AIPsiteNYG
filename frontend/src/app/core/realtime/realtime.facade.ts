import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

import { AuthSessionFacade } from '../auth/auth-session.facade';
import { FrontendFeatureFlagsService } from '../feature-flags/frontend-feature-flags.service';
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
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly transport = inject(AIP_REALTIME_TRANSPORT, { optional: true }) ?? inject(SignalrRealtimeTransport);
  private readonly state = signal<RealtimeConnectionState>('Degraded');
  private readonly events = new Subject<DurableRealtimeEvent>();
  private readonly diagnosticsSubject = new Subject<RealtimeDiagnostic>();
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private readonly catchUps = new Map<string, RealtimeCatchUpCallback>();
  private readonly staleGuards = new Map<string, RealtimeStaleEventGuard>();
  private readonly dedup = new Map<string, number>();
  private readonly aggregateVersions = new Map<string, number>();
  private tenantId: string | null = null;
  private starting: Promise<void> | null = null;
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
      if (!enabled || !authenticated || !tenant?.isAvailable) {
        this.stopForSessionBoundary(enabled ? 'Degraded' : 'Degraded');
        return;
      }

      if (this.tenantId && this.tenantId !== tenant.tenantId) {
        this.clearForTenantBoundary();
      }
      this.tenantId = tenant.tenantId;
      void this.connectAndSynchronize();
    });
  }

  registerSubscription(owner: string, request: RealtimeSubscriptionRequest): () => void {
    validateSubscription(request);
    const key = subscriptionKey(request);
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.owners.add(owner);
    } else {
      this.subscriptions.set(key, { request, owners: new Set([owner]) });
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

  /** Called by session/tenant lifecycle owners before protected state changes. */
  clearForTenantBoundary(): void {
    this.tenantId = null;
    this.clearProtectedRealtimeState();
    this.intentionallyStopped = true;
    void this.transport.stop();
    this.state.set('Degraded');
  }

  clearForAuthorizationLoss(): void {
    this.clearProtectedRealtimeState();
    this.state.set('Reconnecting');
    this.intentionallyStopped = true;
    void this.transport.stop().then(async () => {
      await this.refreshSessionAfterConnectionFailure();
      this.intentionallyStopped = false;
      if (this.canConnect()) {
        await this.connectAndSynchronize();
      } else {
        this.state.set('Degraded');
      }
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
      for (const entry of [...this.subscriptions.values()]) {
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
    if (!result.allowed) {
      this.diagnosticsSubject.next({ code: 'SubscriptionDenied' });
      this.removeDeniedSubscription(request);
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

    this.events.next(event);
    if (event.eventType === 'Security.AuthorizationStateChanged.v1') {
      this.clearForAuthorizationLoss();
    }
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
    const entry = this.subscriptions.get(key);
    if (!entry) {
      return;
    }
    entry.owners.delete(owner);
    if (entry.owners.size > 0) {
      return;
    }
    this.subscriptions.delete(key);
    if (this.isSynchronized() && request.subscriptionType !== 'user' && request.subscriptionType !== 'tenant') {
      void this.transport.unsubscribe(request);
    }
  }

  private removeDeniedSubscription(request: RealtimeSubscriptionRequest): void {
    if (request.subscriptionType !== 'user') {
      this.subscriptions.delete(subscriptionKey(request));
    }
  }

  private handleTransportStatus(status: RealtimeTransportStatus): void {
    if (this.intentionallyStopped) {
      return;
    }
    if (status === 'reconnecting' || status === 'connecting') {
      this.state.set('Reconnecting');
      return;
    }
    if (status === 'reconnected') {
      this.state.set('Reconnecting');
      void this.connectAndSynchronize();
      return;
    }
    if (status === 'closed') {
      this.state.set(this.httpIsLikelyAvailable() ? 'Degraded' : 'Offline');
    }
  }

  private clearProtectedRealtimeState(): void {
    this.subscriptions.clear();
    this.dedup.clear();
    this.aggregateVersions.clear();
  }

  private stopForSessionBoundary(state: RealtimeConnectionState): void {
    this.clearProtectedRealtimeState();
    this.tenantId = null;
    this.intentionallyStopped = true;
    void this.transport.stop();
    this.state.set(state);
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
