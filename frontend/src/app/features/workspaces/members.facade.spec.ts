import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ProtectedStateClearReason, RealtimeFacade } from '../../core/realtime/realtime.facade';
import { WorkspaceMembersFacade } from './members.facade';

describe('WorkspaceMembersFacade', () => {
  let facade: WorkspaceMembersFacade;
  let http: HttpTestingController;
  let clearProtectedState: ((reason: ProtectedStateClearReason) => void) | null;
  let catchUp: (() => Promise<void> | void) | null;

  beforeEach(() => {
    clearProtectedState = null;
    catchUp = null;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: RealtimeFacade,
          useValue: {
            registerProtectedStateClearer: (
              _owner: string,
              clear: (reason: ProtectedStateClearReason) => void,
            ) => {
              clearProtectedState = clear;
              return () => { clearProtectedState = null; };
            },
            registerSubscription: () => () => undefined,
            registerCatchUp: (_owner: string, callback: () => Promise<void> | void) => {
              catchUp = callback;
              return () => { catchUp = null; };
            },
          },
        },
      ],
    });

    facade = TestBed.inject(WorkspaceMembersFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('keeps the page accessor pure and loads live rows explicitly', () => {
    const page = computed(() => facade.getPage('workspace-alpha'));

    expect(() => page()).not.toThrow();
    expect(page().status).toBe('loading');
    http.expectNone('/api/workspaces/workspace-alpha/members');

    facade.ensureLoaded('workspace-alpha');

    const request = http.expectOne('/api/workspaces/workspace-alpha/members');
    expect(request.request.withCredentials).toBe(true);
    request.flush([
      {
        userId: 'user-a',
        displayName: 'Member A',
        role: 'Member',
        status: 'Active',
        joinedAt: '2026-08-23T00:00:00Z',
      },
    ]);

    expect(page().status).toBe('ready');
    expect(page().rows).toHaveLength(1);
    expect(page().rows[0].workspaceId).toBe('workspace-alpha');
  });

  it('cancels late member responses and reloads only through authorization recovery', () => {
    facade.ensureLoaded('workspace-alpha');
    const stale = http.expectOne('/api/workspaces/workspace-alpha/members');

    clearProtectedState?.('authorization');

    expect(stale.cancelled).toBe(true);
    expect(facade.getPage('workspace-alpha').rows).toEqual([]);
    expect(facade.getPage('workspace-alpha').status).toBe('loading');

    catchUp?.();
    http.expectOne('/api/workspaces/workspace-alpha/members').flush([
      { userId: 'user-current', displayName: 'Current Member', role: 'Member', status: 'Active' },
    ]);

    expect(facade.getPage('workspace-alpha').rows.map((row) => row.id)).toEqual([
      'user-current',
    ]);
  });

  it('keeps authorization catch-up pending until the authoritative member request settles', async () => {
    facade.ensureLoaded('workspace-alpha');
    http.expectOne('/api/workspaces/workspace-alpha/members').flush([]);
    clearProtectedState?.('authorization');

    const completion = catchUp?.();
    expect(completion).toBeInstanceOf(Promise);
    let settled = false;
    void Promise.resolve(completion).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    http.expectOne('/api/workspaces/workspace-alpha/members').flush([
      { userId: 'user-current', displayName: 'Current Member', role: 'Member', status: 'Active' },
    ]);
    await completion;

    expect(settled).toBe(true);
    expect(facade.getPage('workspace-alpha').rows.map((row) => row.id)).toEqual([
      'user-current',
    ]);
  });

  it('fails a revoked mounted member route closed during degraded HTTP recovery', () => {
    facade.ensureLoaded('workspace-alpha');
    http.expectOne('/api/workspaces/workspace-alpha/members').flush([
      { userId: 'user-old', displayName: 'Old Member', role: 'Member', status: 'Active' },
    ]);

    clearProtectedState?.('authorization');
    catchUp?.();
    http.expectOne('/api/workspaces/workspace-alpha/members').flush(
      { error: 'revoked' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(facade.getPage('workspace-alpha')).toMatchObject({
      status: 'permissionDenied',
      rows: [],
    });
  });

  it('discards the mounted member intent at a genuine Workspace boundary', () => {
    facade.ensureLoaded('workspace-alpha');
    http.expectOne('/api/workspaces/workspace-alpha/members').flush([]);

    clearProtectedState?.('workspace');

    expect(catchUp).toBeNull();
    expect(facade.getPage('workspace-alpha')).toMatchObject({ status: 'loading', rows: [] });
  });
});
