import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { WorkspaceSelectionFacade } from '../../core/workspace/workspace-selection.facade';
import { WorkspacesFacade } from './workspaces.facade';

const workspaceDto = {
  id: 'workspace-1',
  name: 'Backend Workspace',
  description: 'Authoritative dashboard card',
  icon: null,
  status: 0,
  createdAt: '2026-08-22T00:00:00Z',
  updatedAt: '2026-08-23T00:00:00Z',
  currentUserRole: 'Owner',
  accessSource: 'WorkspaceMembership',
  canOpenWorkspace: true,
  canOpenMembers: false,
  canOpenProjects: true,
  unreadAnnouncementCount: 0,
  unreadConversationCount: 5,
  inProgressProjectCount: 2,
  runningProjectCount: 1,
  needsReviewProjectCount: 1,
};

describe('WorkspacesFacade live dashboard projection', () => {
  let facade: WorkspacesFacade;
  let http: HttpTestingController;
  let workspaceSelection: {
    beginLoading: ReturnType<typeof vi.fn>;
    reconcileAuthorizedWorkspaces: ReturnType<typeof vi.fn>;
    markUnavailable: ReturnType<typeof vi.fn>;
    markAuthorizationPending: ReturnType<typeof vi.fn>;
    markTransientFailure: ReturnType<typeof vi.fn>;
  };
  let realtimeState: WritableSignal<'Connected' | 'Reconnecting' | 'Degraded'>;
  let authorizationRevision: WritableSignal<number>;
  let catchUp: (() => Promise<void> | void) | null;

  beforeEach(() => {
    workspaceSelection = {
      beginLoading: vi.fn(),
      reconcileAuthorizedWorkspaces: vi.fn(() => ({
        status: 'selected',
        workspaceId: 'workspace-1',
        source: 'single',
      })),
      markUnavailable: vi.fn(),
      markAuthorizationPending: vi.fn(),
      markTransientFailure: vi.fn(),
    };
    realtimeState = signal<'Connected' | 'Reconnecting' | 'Degraded'>('Connected');
    authorizationRevision = signal(0);
    catchUp = null;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WorkspaceSelectionFacade, useValue: workspaceSelection },
        {
          provide: RealtimeFacade,
          useValue: {
            connectionState: realtimeState,
            authorizationRevision,
            registerCatchUp: vi.fn((_owner: string, callback: () => Promise<void> | void) => {
              catchUp = callback;
              return () => undefined;
            }),
            runAuthoritativeHttpCatchUps: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthSessionFacade,
          useValue: {
            session: signal({
              isAuthenticated: true,
              currentTenant: { tenantId: 'tenant-a' },
              currentUser: { userId: 'user-a' },
              capabilities: [],
            }),
          },
        },
      ],
    });

    facade = TestBed.inject(WorkspacesFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('maps the complete list and enveloped page capability without placeholders', () => {
    const capabilitiesRequest = http.expectOne('/api/workspaces/capabilities');
    expect(capabilitiesRequest.request.withCredentials).toBe(true);
    capabilitiesRequest.flush({
      requestId: 'request-capabilities',
      data: { canCreate: true },
      warnings: [],
    });

    const listRequest = http.expectOne('/api/workspaces');
    expect(listRequest.request.withCredentials).toBe(true);
    listRequest.flush([workspaceDto]);

    expect(facade.dashboard()).toMatchObject({
      status: 'ready',
      pageCapabilities: ['createWorkspace'],
    });
    expect(facade.dashboard().message).toBeUndefined();
    expect(facade.dashboard().workspaces[0]).toMatchObject({
      id: 'workspace-1',
      currentUserRole: 'Owner',
      accessSource: 'WorkspaceMembership',
      roleLabel: '管理者',
      unreadAnnouncementCount: 0,
      unreadConversationCount: 5,
      activeProjectCount: 2,
      runningProjectCount: 1,
      needsReviewProjectCount: 1,
      capabilities: ['openWorkspace', 'openProjects'],
    });
    expect(workspaceSelection.reconcileAuthorizedWorkspaces).toHaveBeenCalledWith(
      [{ id: 'workspace-1', label: 'Backend Workspace' }],
      { tenantId: 'tenant-a', userId: 'user-a' },
      null,
    );
  });

  it('neutralizes a mounted explicit Workspace route when that Workspace is revoked', () => {
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/workspaces/revoked-workspace/members');
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    workspaceSelection.reconcileAuthorizedWorkspaces.mockReturnValue({
      status: 'unavailable',
      workspaceId: null,
      source: null,
    });

    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });
    http.expectOne('/api/workspaces').flush([workspaceDto]);

    expect(workspaceSelection.reconcileAuthorizedWorkspaces).toHaveBeenCalledWith(
      [{ id: 'workspace-1', label: 'Backend Workspace' }],
      { tenantId: 'tenant-a', userId: 'user-a' },
      'revoked-workspace',
    );
    expect(navigate).toHaveBeenCalledWith('/workspaces');
  });

  it('shows the no-access state while retaining backend-authorized create capability', () => {
    http.expectOne('/api/workspaces').flush([]);
    http.expectOne('/api/workspaces/capabilities').flush({
      requestId: 'request-capabilities',
      data: { canCreate: true },
      warnings: [],
    });

    expect(facade.dashboard()).toMatchObject({
      status: 'noWorkspaceAccess',
      workspaces: [],
      pageCapabilities: ['createWorkspace'],
    });
    expect(workspaceSelection.reconcileAuthorizedWorkspaces).toHaveBeenCalledWith(
      [],
      { tenantId: 'tenant-a', userId: 'user-a' },
      null,
    );
  });

  it.each([401, 403])('maps HTTP %s to a safe permission-denied state', (status) => {
    http
      .expectOne('/api/workspaces')
      .flush(
        { requestId: 'request-denied', error: { code: 'CapabilityDenied' } },
        { status, statusText: 'Denied' },
      );
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });

    expect(facade.dashboard()).toMatchObject({
      status: 'permissionDenied',
      workspaces: [],
      pageCapabilities: [],
    });
    expect(workspaceSelection.markUnavailable).toHaveBeenCalledWith(true);
  });

  it('does not fabricate cards or counts when the dashboard projection fails', () => {
    http
      .expectOne('/api/workspaces')
      .flush(
        { requestId: 'request-failed', error: { code: 'DependencyUnavailable' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: true } });

    expect(facade.dashboard()).toMatchObject({
      status: 'error',
      workspaces: [],
      pageCapabilities: [],
    });
    expect(workspaceSelection.markTransientFailure).toHaveBeenCalledOnce();
  });

  it('fails page create capability closed without hiding an authorized card', () => {
    http.expectOne('/api/workspaces').flush([workspaceDto]);
    http
      .expectOne('/api/workspaces/capabilities')
      .flush(
        { requestId: 'request-capability-failed' },
        { status: 503, statusText: 'Service Unavailable' },
      );

    expect(facade.dashboard()).toMatchObject({
      status: 'ready',
      pageCapabilities: [],
    });
    expect(facade.dashboard().workspaces).toHaveLength(1);
  });

  it('treats a malformed successful list as an error rather than no Workspace access', () => {
    http.expectOne('/api/workspaces').flush({ items: [workspaceDto] });
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });

    expect(facade.dashboard()).toMatchObject({
      status: 'error',
      workspaces: [],
      pageCapabilities: [],
    });
    expect(workspaceSelection.markTransientFailure).toHaveBeenCalledOnce();
  });

  it('cancels an older Workspace list and ignores its late capability response', () => {
    const firstList = http.expectOne('/api/workspaces');
    const firstCapabilities = http.expectOne('/api/workspaces/capabilities');

    facade.loadWorkspaces();

    const currentList = http.expectOne('/api/workspaces');
    const currentCapabilities = http.expectOne('/api/workspaces/capabilities');
    currentCapabilities.flush({ data: { canCreate: false } });
    currentList.flush([{ ...workspaceDto, id: 'workspace-current', name: 'Current' }]);

    firstCapabilities.flush({ data: { canCreate: true } });
    expect(firstList.cancelled).toBe(true);

    expect(facade.dashboard().pageCapabilities).toEqual([]);
    expect(facade.dashboard().workspaces.map((workspace) => workspace.id)).toEqual([
      'workspace-current',
    ]);
    expect(workspaceSelection.reconcileAuthorizedWorkspaces).toHaveBeenLastCalledWith(
      [{ id: 'workspace-current', label: 'Current' }],
      { tenantId: 'tenant-a', userId: 'user-a' },
      null,
    );
  });

  it('hides stale cards on authorization recheck and reloads from the catch-up boundary', () => {
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });
    http.expectOne('/api/workspaces').flush([workspaceDto]);
    expect(facade.dashboard().status).toBe('ready');

    authorizationRevision.set(1);
    TestBed.flushEffects();

    expect(facade.dashboard()).toMatchObject({ status: 'loading', workspaces: [] });
    expect(workspaceSelection.markAuthorizationPending).toHaveBeenCalledOnce();

    catchUp?.();
    const refreshedCapabilities = http.expectOne('/api/workspaces/capabilities');
    const refreshedList = http.expectOne('/api/workspaces');
    refreshedCapabilities.flush({ data: { canCreate: false } });
    refreshedList.flush([{ ...workspaceDto, id: 'workspace-after-revoke', name: 'Still Authorized' }]);

    expect(facade.dashboard().workspaces.map((workspace) => workspace.id)).toEqual([
      'workspace-after-revoke',
    ]);
    expect(workspaceSelection.reconcileAuthorizedWorkspaces).toHaveBeenLastCalledWith(
      [{ id: 'workspace-after-revoke', label: 'Still Authorized' }],
      { tenantId: 'tenant-a', userId: 'user-a' },
      null,
    );
  });

  it('keeps the Workspace authorization catch-up pending until the list response settles', async () => {
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });
    http.expectOne('/api/workspaces').flush([workspaceDto]);
    authorizationRevision.set(1);
    TestBed.flushEffects();

    const completion = catchUp?.();
    expect(completion).toBeInstanceOf(Promise);
    let settled = false;
    void Promise.resolve(completion).then(() => { settled = true; });
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });
    await Promise.resolve();
    expect(settled).toBe(false);

    http.expectOne('/api/workspaces').flush([
      { ...workspaceDto, id: 'workspace-reauthorized' },
    ]);
    await completion;

    expect(settled).toBe(true);
    expect(facade.dashboard().workspaces[0].id).toBe('workspace-reauthorized');
  });

  it('cancels and settles an obsolete Workspace catch-up before a second authorization pass', async () => {
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });
    http.expectOne('/api/workspaces').flush([workspaceDto]);
    authorizationRevision.set(1);
    TestBed.flushEffects();

    const firstCompletion = catchUp?.();
    const firstCapabilities = http.expectOne('/api/workspaces/capabilities');
    const firstList = http.expectOne('/api/workspaces');
    authorizationRevision.set(2);
    TestBed.flushEffects();

    expect(firstList.cancelled).toBe(true);
    await firstCompletion;

    const secondCompletion = catchUp?.();
    const secondCapabilities = http.expectOne('/api/workspaces/capabilities');
    const secondList = http.expectOne('/api/workspaces');
    firstCapabilities.flush({ data: { canCreate: false } });
    secondCapabilities.flush({ data: { canCreate: false } });
    secondList.flush([{ ...workspaceDto, id: 'workspace-second-pass' }]);
    await secondCompletion;

    expect(facade.dashboard().workspaces[0].id).toBe('workspace-second-pass');
  });

  it('preserves the authorized dashboard and selection on an ordinary transport reconnect', () => {
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });
    http.expectOne('/api/workspaces').flush([workspaceDto]);
    workspaceSelection.beginLoading.mockClear();
    workspaceSelection.markUnavailable.mockClear();
    workspaceSelection.reconcileAuthorizedWorkspaces.mockClear();

    realtimeState.set('Reconnecting');
    TestBed.flushEffects();
    catchUp?.();

    expect(facade.dashboard()).toMatchObject({
      status: 'ready',
      workspaces: [{ id: 'workspace-1' }],
    });
    expect(workspaceSelection.beginLoading).not.toHaveBeenCalled();
    expect(workspaceSelection.markUnavailable).not.toHaveBeenCalled();
    expect(workspaceSelection.reconcileAuthorizedWorkspaces).not.toHaveBeenCalled();
    http.expectNone('/api/workspaces');
    http.expectNone('/api/workspaces/capabilities');
  });

  it('falls back to an authoritative HTTP reload when realtime reauthorization degrades', () => {
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });
    http.expectOne('/api/workspaces').flush([workspaceDto]);

    authorizationRevision.set(1);
    realtimeState.set('Reconnecting');
    TestBed.flushEffects();
    realtimeState.set('Degraded');
    TestBed.flushEffects();

    const refreshedCapabilities = http.expectOne('/api/workspaces/capabilities');
    const refreshedList = http.expectOne('/api/workspaces');
    refreshedCapabilities.flush({ data: { canCreate: false } });
    refreshedList.flush([{ ...workspaceDto, id: 'workspace-http-authorized' }]);

    expect(facade.dashboard().workspaces.map((workspace) => workspace.id)).toEqual([
      'workspace-http-authorized',
    ]);
    expect(TestBed.inject(RealtimeFacade).runAuthoritativeHttpCatchUps).toHaveBeenCalledOnce();
  });

  it('keeps reconnect catch-up pending on the same revision until a degraded fallback settles', async () => {
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });
    http.expectOne('/api/workspaces').flush([workspaceDto]);
    authorizationRevision.set(1);
    realtimeState.set('Reconnecting');
    TestBed.flushEffects();
    realtimeState.set('Degraded');
    TestBed.flushEffects();

    const fallbackCapabilities = http.expectOne('/api/workspaces/capabilities');
    const fallbackList = http.expectOne('/api/workspaces');
    realtimeState.set('Reconnecting');
    const completion = catchUp?.();
    expect(completion).toBeInstanceOf(Promise);
    let settled = false;
    void Promise.resolve(completion).then(() => { settled = true; });
    fallbackCapabilities.flush({ data: { canCreate: false } });
    await Promise.resolve();
    expect(settled).toBe(false);

    fallbackList.flush([{ ...workspaceDto, id: 'workspace-fallback-current' }]);
    await completion;

    expect(settled).toBe(true);
    expect(facade.dashboard().workspaces[0].id).toBe('workspace-fallback-current');
  });
});
