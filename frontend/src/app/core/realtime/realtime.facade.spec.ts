import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { AIP_AUTH_SESSION_MOCK, AuthSessionFacade, AuthSessionSnapshot, DEFAULT_AUTH_SESSION } from '../auth/auth-session.facade';
import { FrontendFeatureFlagsService } from '../feature-flags/frontend-feature-flags.service';
import { DurableRealtimeEvent, RealtimeSubscriptionRequest, RealtimeSubscriptionResult } from './realtime.models';
import { AIP_REALTIME_TRANSPORT, RealtimeTransport, RealtimeTransportStatus } from './realtime-transport';
import { RealtimeFacade } from './realtime.facade';

// The deterministic default Tenant is a canonical, non-empty .NET Guid but
// intentionally does not encode RFC UUID version/variant bits.
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';

class FakeRealtimeTransport implements RealtimeTransport {
  readonly events = new Subject<unknown>();
  readonly invalidations = new Subject<void>();
  readonly statuses = new Subject<RealtimeTransportStatus>();
  readonly durableEvents$ = this.events.asObservable();
  readonly authorizationInvalidations$ = this.invalidations.asObservable();
  readonly statuses$ = this.statuses.asObservable();
  readonly subscribed: RealtimeSubscriptionRequest[] = [];
  readonly unsubscribed: RealtimeSubscriptionRequest[] = [];
  startCalls = 0;
  stopCalls = 0;
  result: RealtimeSubscriptionResult = { allowed: true, code: 'Subscribed' };
  deniedSubscriptionType: RealtimeSubscriptionRequest['subscriptionType'] | null = null;

  async start(): Promise<void> { this.startCalls += 1; }
  async stop(): Promise<void> { this.stopCalls += 1; }
  async subscribe(request: RealtimeSubscriptionRequest): Promise<RealtimeSubscriptionResult> {
    this.subscribed.push(request);
    if (request.subscriptionType === this.deniedSubscriptionType)
      return { allowed: false, code: 'Forbidden' };
    return this.result;
  }
  async unsubscribe(request: RealtimeSubscriptionRequest): Promise<RealtimeSubscriptionResult> {
    this.unsubscribed.push(request);
    return { allowed: true, code: 'Unsubscribed' };
  }
}

describe('RealtimeFacade', () => {
  let facade: RealtimeFacade;
  let transport: FakeRealtimeTransport;
  let auth: AuthSessionFacade;
  let flags: FrontendFeatureFlagsService;

  beforeEach(() => {
    transport = new FakeRealtimeTransport();
    TestBed.configureTestingModule({
      providers: [
        { provide: AIP_AUTH_SESSION_MOCK, useValue: { ...DEFAULT_AUTH_SESSION, status: 'anonymous', currentUser: null, currentTenant: null, isAuthenticated: false } },
        { provide: AIP_REALTIME_TRANSPORT, useValue: transport }
      ]
    });
    facade = TestBed.inject(RealtimeFacade);
    auth = TestBed.inject(AuthSessionFacade);
    flags = TestBed.inject(FrontendFeatureFlagsService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keeps HTTP-only mode when the rollout flag is disabled', async () => {
    auth.setMockSession(activeSession());
    await settle();

    expect(transport.startCalls).toBe(0);
    expect(facade.connectionState()).toBe('Degraded');
  });

  it('owns exactly one connection and subscribes to the server-derived current user target', async () => {
    await enableAndAuthenticate();

    expect(transport.startCalls).toBe(1);
    expect(transport.subscribed).toEqual([{ subscriptionType: 'user' }]);
    expect(facade.connectionState()).toBe('Connected');
  });

  it('reauthorizes subscriptions and runs catch-up before returning to Connected', async () => {
    const order: string[] = [];
    facade.registerSubscription('conversation-page', { subscriptionType: 'conversation', resourceId: RESOURCE_ID });
    facade.registerCatchUp('conversation-page', async () => { order.push('catch-up'); });
    await enableAndAuthenticate();

    expect(transport.subscribed).toEqual([
      { subscriptionType: 'user' },
      { subscriptionType: 'conversation', resourceId: RESOURCE_ID }
    ]);
    expect(order).toEqual(['catch-up']);
    expect(facade.connectionState()).toBe('Connected');

    transport.statuses.next('reconnecting');
    expect(facade.connectionState()).toBe('Reconnecting');
    transport.statuses.next('reconnected');
    await settle();
    expect(transport.subscribed.slice(-2)).toEqual([
      { subscriptionType: 'user' },
      { subscriptionType: 'conversation', resourceId: RESOURCE_ID }
    ]);
    expect(order).toEqual(['catch-up', 'catch-up']);
    expect(facade.connectionState()).toBe('Connected');
  });

  it('ReconnectRestoresDesiredProjectSubscription', async () => {
    facade.registerSubscription('project-detail', { subscriptionType: 'project', resourceId: RESOURCE_ID });
    await enableAndAuthenticate();

    transport.statuses.next('reconnecting');
    transport.statuses.next('reconnected');
    await waitForConnection(facade);

    expect(transport.subscribed.filter((request) => request.subscriptionType === 'project')).toEqual([
      { subscriptionType: 'project', resourceId: RESOURCE_ID },
      { subscriptionType: 'project', resourceId: RESOURCE_ID },
    ]);
  });

  it('ReconnectRestoresDesiredWorkspaceSubscription', async () => {
    facade.registerSubscription('workspace-shell', { subscriptionType: 'workspace', resourceId: RESOURCE_ID });
    await enableAndAuthenticate();

    transport.statuses.next('reconnecting');
    transport.statuses.next('reconnected');
    await waitForConnection(facade);

    expect(transport.subscribed.filter((request) => request.subscriptionType === 'workspace')).toEqual([
      { subscriptionType: 'workspace', resourceId: RESOURCE_ID },
      { subscriptionType: 'workspace', resourceId: RESOURCE_ID },
    ]);
  });

  it('reports a denied subscription owner to catch-up before reconnect completes', async () => {
    const deniedOwners: string[][] = [];
    facade.registerSubscription('project-detail', {
      subscriptionType: 'project',
      resourceId: RESOURCE_ID
    });
    facade.registerCatchUp('project-detail', (context) => {
      deniedOwners.push([...context.deniedOwners]);
    });
    await enableAndAuthenticate();

    transport.deniedSubscriptionType = 'project';
    transport.statuses.next('reconnecting');
    transport.statuses.next('reconnected');
    await settle();
    await settle();

    expect(deniedOwners).toEqual([[], ['project-detail']]);
    expect(facade.connectionState()).toBe('Connected');
  });

  it('AuthorizationInvalidationReauthorizesRegisteredFeatureSubscription', async () => {
    const deniedOwners: string[][] = [];
    facade.registerSubscription('project-detail', { subscriptionType: 'project', resourceId: RESOURCE_ID });
    facade.registerCatchUp('project-detail', (context) => {
      deniedOwners.push([...context.deniedOwners]);
    });
    await enableAndAuthenticate();

    transport.deniedSubscriptionType = 'project';
    transport.invalidations.next();
    await waitForConnection(facade);

    expect(transport.subscribed.filter((request) => request.subscriptionType === 'project')).toHaveLength(2);
    expect(deniedOwners).toEqual([[], ['project-detail']]);

    transport.deniedSubscriptionType = null;
    transport.statuses.next('reconnecting');
    transport.statuses.next('reconnected');
    await waitForConnection(facade);
    expect(transport.subscribed.filter((request) => request.subscriptionType === 'project')).toHaveLength(3);
  });

  it('DeniedSubscriptionDoesNotRestoreProtectedState', async () => {
    let protectedTitle = 'Restricted task title';
    const deniedOwners: string[][] = [];
    facade.registerSubscription('project-detail', { subscriptionType: 'project', resourceId: RESOURCE_ID });
    facade.registerProtectedStateClearer('project-detail', () => { protectedTitle = ''; });
    facade.registerCatchUp('project-detail', (context) => {
      deniedOwners.push([...context.deniedOwners]);
      if (!context.deniedOwners.has('project-detail')) protectedTitle = 'refetched title';
    });
    await enableAndAuthenticate();
    protectedTitle = 'Restricted task title';

    transport.deniedSubscriptionType = 'project';
    transport.invalidations.next();
    await waitForConnection(facade);

    expect(deniedOwners.at(-1)).toEqual(['project-detail']);
    expect(protectedTitle).toBe('');
  });

  it('notifies every denied owner even when an earlier catch-up fails', async () => {
    const deniedOwners: string[][] = [];
    const diagnostics: string[] = [];
    facade.diagnostics$.subscribe((diagnostic) => diagnostics.push(diagnostic.code));
    facade.registerSubscription('project-detail', {
      subscriptionType: 'project',
      resourceId: RESOURCE_ID
    });
    await enableAndAuthenticate();
    facade.registerCatchUp('failing-feature', async () => {
      throw new Error('HTTP catch-up failed.');
    });
    facade.registerCatchUp('project-detail', (context) => {
      deniedOwners.push([...context.deniedOwners]);
    });

    transport.deniedSubscriptionType = 'project';
    transport.statuses.next('reconnecting');
    transport.statuses.next('reconnected');
    await settle();
    await settle();

    expect(deniedOwners).toEqual([['project-detail']]);
    expect(diagnostics).toContain('CatchUpFailed');
  });

  it('does not send guessed group names and only maps approved logical targets to the transport', async () => {
    facade.registerSubscription('project-page', { subscriptionType: 'project', resourceId: RESOURCE_ID });
    await enableAndAuthenticate();

    expect(JSON.stringify(transport.subscribed)).not.toContain('project:');
    expect(JSON.stringify(transport.subscribed)).not.toContain('tenant:');
  });

  it('removes the final subscription owner and does not leak route subscriptions', async () => {
    await enableAndAuthenticate();
    const removeA = facade.registerSubscription('route-a', { subscriptionType: 'workspace', resourceId: RESOURCE_ID });
    const removeB = facade.registerSubscription('route-b', { subscriptionType: 'workspace', resourceId: RESOURCE_ID });
    await settle();
    removeA();
    expect(transport.unsubscribed).toEqual([]);
    removeB();
    await settle();
    expect(transport.unsubscribed).toEqual([{ subscriptionType: 'workspace', resourceId: RESOURCE_ID }]);
  });

  it('clears subscriptions and bounded state at tenant, logout, session-expiry, and authorization boundaries', async () => {
    await enableAndAuthenticate();
    facade.registerSubscription('route', { subscriptionType: 'project', resourceId: RESOURCE_ID });
    facade.clearForTenantBoundary();
    await settle();
    expect(transport.stopCalls).toBeGreaterThan(0);

    auth.markSessionExpired();
    await settle();
    expect(facade.connectionState()).toBe('Degraded');
    transport.invalidations.next();
    expect(facade.connectionState()).toBe('Reconnecting');
  });

  it('LogoutDoesNotReusePreviousTenantSubscriptions', async () => {
    facade.registerSubscription('project-detail', { subscriptionType: 'project', resourceId: RESOURCE_ID });
    await enableAndAuthenticate();
    expect(transport.subscribed.filter((request) => request.subscriptionType === 'project')).toHaveLength(1);

    auth.markSessionExpired();
    await settle();
    auth.setMockSession(activeSession());
    await waitForConnection(facade);

    expect(transport.subscribed.filter((request) => request.subscriptionType === 'project')).toHaveLength(1);
    expect(transport.subscribed.filter((request) => request.subscriptionType === 'user')).toHaveLength(2);
  });

  it('TenantSwitchDoesNotReusePreviousTenantSubscriptions', async () => {
    facade.registerSubscription('workspace-shell', { subscriptionType: 'workspace', resourceId: RESOURCE_ID });
    await enableAndAuthenticate();
    expect(transport.subscribed.filter((request) => request.subscriptionType === 'workspace')).toHaveLength(1);

    auth.setMockSession(activeSession('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    await waitForConnection(facade);
    await waitForSubscriptionCount(transport, 'user', 2);

    expect(transport.subscribed.filter((request) => request.subscriptionType === 'workspace')).toHaveLength(1);
    expect(transport.subscribed.filter((request) => request.subscriptionType === 'user')).toHaveLength(2);
  });

  it('AuthorizationInvalidationClearsProtectedStateBeforeReauthorizationCatchUp', async () => {
    const order: string[] = [];
    const received: DurableRealtimeEvent[] = [];
    facade.registerProtectedStateClearer('right-panel', () => order.push('clear'));
    facade.registerCatchUp('right-panel', () => { order.push('catch-up'); });
    facade.durableEvents$.subscribe((value) => received.push(value));
    await enableAndAuthenticate();
    order.length = 0;

    transport.events.next(event({
      eventId: '77777777-7777-4777-8777-777777777777',
      eventType: 'Security.AuthorizationStateChanged.v1',
      aggregateType: 'AuthorizationState',
      payload: { affectedUserId: RESOURCE_ID, scopeType: 'workspace', change: 'archived' },
    }));

    expect(order).toEqual(['clear']);
    expect(received).toEqual([]);
    await waitForConnection(facade);
    expect(order).toEqual(['clear', 'catch-up']);
    expect(transport.subscribed.filter((request) => request.subscriptionType === 'user')).toHaveLength(2);
    expect(facade.connectionState()).toBe('Connected');
  });

  it('rejects unknown schemas and duplicate event IDs without exposing payloads', async () => {
    const received: DurableRealtimeEvent[] = [];
    const diagnostics: string[] = [];
    facade.durableEvents$.subscribe((event) => received.push(event));
    facade.diagnostics$.subscribe((diagnostic) => diagnostics.push(diagnostic.code));
    await enableAndAuthenticate();

    transport.events.next({ ...event(), eventType: 'Unknown.Event.v99', payload: { privateBody: 'do not persist' } });
    transport.events.next(event());
    transport.events.next(event());

    expect(received).toHaveLength(1);
    expect(diagnostics).toEqual(['UnsupportedEvent', 'DuplicateEvent']);
    expect(JSON.stringify(sessionStorage)).not.toContain('privateBody');
    expect(JSON.stringify(localStorage)).not.toContain('privateBody');
  });

  it('rejects stale aggregate versions and honors registered feature stale guards', async () => {
    const received: DurableRealtimeEvent[] = [];
    facade.durableEvents$.subscribe((value) => received.push(value));
    facade.registerStaleEventGuard('feature', (value) => value.eventType !== 'Files.FileChanged.v1');
    await enableAndAuthenticate();

    transport.events.next(event({ aggregateVersion: 2 }));
    transport.events.next(event({ eventId: '33333333-3333-4333-8333-333333333333', aggregateVersion: 1 }));
    transport.events.next(event({ eventId: '44444444-4444-4444-8444-444444444444', eventType: 'Files.FileChanged.v1' }));

    expect(received).toHaveLength(1);
  });

  it('falls back to degraded mode when the connection cannot start while preserving session state', async () => {
    transport.start = async () => { throw new Error('network unavailable'); };
    flags.setForTesting({ 'realtime.signalR': true });
    auth.setMockSession(activeSession());
    await settle();

    expect(facade.connectionState()).toBe('Degraded');
    expect(auth.isAuthenticated()).toBe(true);
  });

  async function enableAndAuthenticate(): Promise<void> {
    flags.setForTesting({ 'realtime.signalR': true });
    auth.setMockSession(activeSession());
    await settle();
  }
});

function activeSession(tenantId = TENANT_ID): AuthSessionSnapshot {
  return {
    ...DEFAULT_AUTH_SESSION,
    status: 'active',
    isAuthenticated: true,
    currentTenant: { ...DEFAULT_AUTH_SESSION.currentTenant!, tenantId, isAvailable: true }
  };
}

function event(overrides: Partial<DurableRealtimeEvent> = {}): DurableRealtimeEvent {
  return {
    eventId: '33333333-3333-4333-8333-333333333333',
    eventType: 'Projects.ProjectChanged.v1',
    payloadSchemaVersion: 1,
    occurredAt: '2026-07-18T00:00:00.000Z',
    tenantId: TENANT_ID,
    aggregateType: 'Project',
    aggregateId: RESOURCE_ID,
    aggregateVersion: 1,
    actor: { actorType: 'User', actorId: '55555555-5555-4555-8555-555555555555' },
    correlationId: null,
    causationId: null,
    payload: {},
    ...overrides
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

async function waitForConnection(facade: RealtimeFacade): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (facade.connectionState() === 'Connected') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForSubscriptionCount(
  transport: FakeRealtimeTransport,
  subscriptionType: RealtimeSubscriptionRequest['subscriptionType'],
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (transport.subscribed.filter((request) => request.subscriptionType === subscriptionType).length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
