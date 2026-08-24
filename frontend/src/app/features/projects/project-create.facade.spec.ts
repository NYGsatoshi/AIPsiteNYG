import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { ProjectCreateInput, PROJECT_VISIBILITY_MEMBERS_ONLY } from './project-create.api';
import { ProjectCreateFacade } from './project-create.facade';
import { ProjectsFacade } from './projects.facade';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const secondWorkspaceId = '99999999-9999-4999-8999-999999999999';
const projectId = '22222222-2222-4222-8222-222222222222';
const ownerUserId = '33333333-3333-4333-8333-333333333333';
const groupId = '44444444-4444-4444-8444-444444444444';

const optionsEnvelope = {
  requestId: 'request-options',
  data: {
    workspaceId,
    canCreateUngrouped: true,
    allowedVisibilities: [PROJECT_VISIBILITY_MEMBERS_ONLY],
    groups: [{ id: groupId, name: 'Research Group' }],
  },
  warnings: [],
};

const input: ProjectCreateInput = {
  title: 'Evidence review',
  description: null,
  groupId: null,
  visibility: PROJECT_VISIBILITY_MEMBERS_ONLY,
  startDate: '2026-08-24',
  endDate: '2026-08-28',
};

const successEnvelope = {
  requestId: 'request-create',
  data: {
    id: projectId,
    workspaceId,
    groupId: null,
    ownerUserId,
    title: input.title,
    description: null,
    status: 0,
    visibility: PROJECT_VISIBILITY_MEMBERS_ONLY,
    activationState: 1,
    startDate: input.startDate,
    endDate: input.endDate,
    versionNo: 1,
    createdAt: '2026-08-24T01:02:03Z',
  },
  warnings: [],
};

const projectConfirmation = {
  id: projectId,
  workspaceId,
  status: 0,
  activationState: 1,
};

describe('ProjectCreateFacade', () => {
  let facade: ProjectCreateFacade;
  let http: HttpTestingController;
  let authSession: WritableSignal<Record<string, unknown>>;
  let activeWorkspace: WritableSignal<{ id: string; label: string } | null>;
  let protectedClearer:
    ((reason: 'session' | 'tenant' | 'authorization' | 'workspace') => void) | null;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let projects: { retryProjects: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authSession = signal({
      isAuthenticated: true,
      currentTenant: { tenantId: 'tenant-a' },
      currentUser: { userId: 'user-a' },
    });
    activeWorkspace = signal({ id: workspaceId, label: 'Evidence Workspace' });
    protectedClearer = null;
    router = { navigate: vi.fn().mockResolvedValue(true) };
    projects = { retryProjects: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ProjectCreateFacade,
        { provide: Router, useValue: router },
        { provide: ProjectsFacade, useValue: projects },
        { provide: AuthSessionFacade, useValue: { session: authSession } },
        { provide: ActiveWorkspaceFacade, useValue: { activeWorkspace } },
        {
          provide: RealtimeFacade,
          useValue: {
            registerProtectedStateClearer: vi.fn(
              (
                _owner: string,
                clearer: (reason: 'session' | 'tenant' | 'authorization' | 'workspace') => void,
              ) => {
                protectedClearer = clearer;
                return () => undefined;
              },
            ),
          },
        },
      ],
    });

    facade = TestBed.inject(ProjectCreateFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  const loadOptions = async (): Promise<void> => {
    const load = facade.loadOptions(workspaceId);
    const request = http.expectOne(`/api/workspaces/${workspaceId}/projects/create-options`);
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush(optionsEnvelope);
    await expect(load).resolves.toBe(true);
  };

  it('loads only strict server-owned options and fails closed on denial', async () => {
    await loadOptions();
    expect(facade.options()).toMatchObject({
      status: 'ready',
      data: {
        workspaceId,
        canCreateUngrouped: true,
        groups: [{ id: groupId, name: 'Research Group' }],
      },
    });

    const noAuthority = facade.loadOptions(workspaceId);
    http.expectOne(`/api/workspaces/${workspaceId}/projects/create-options`).flush({
      requestId: 'request-options-no-authority',
      data: {
        workspaceId,
        canCreateUngrouped: false,
        allowedVisibilities: [],
        groups: [],
      },
      warnings: [],
    });
    await expect(noAuthority).resolves.toBe(false);
    expect(facade.options().status).toBe('denied');

    const denied = facade.loadOptions(workspaceId);
    http
      .expectOne(`/api/workspaces/${workspaceId}/projects/create-options`)
      .flush(
        { requestId: 'request-denied', message: 'Denied' },
        { status: 403, statusText: 'Forbidden' },
      );
    await expect(denied).resolves.toBe(false);
    expect(facade.options().status).toBe('denied');
  });

  it('posts the canonical body once, commits before refresh, and navigates to Draft detail', async () => {
    await loadOptions();

    const create = facade.createProject(workspaceId, {
      ...input,
      title: '  Evidence review  ',
      description: '   ',
    });
    const post = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    expect(post.request.method).toBe('POST');
    expect(post.request.withCredentials).toBe(true);
    expect(post.request.body).toEqual({
      title: 'Evidence review',
      description: null,
      groupId: null,
      visibility: PROJECT_VISIBILITY_MEMBERS_ONLY,
      startDate: '2026-08-24',
      endDate: '2026-08-28',
    });
    expect(post.request.body).not.toHaveProperty('workspaceId');
    expect(post.request.body).not.toHaveProperty('members');
    expect(post.request.headers.get('Idempotency-Key')).toMatch(/^project-create-[\x20-\x7e]+$/u);

    await expect(facade.createProject(workspaceId, input)).resolves.toBe(false);
    http.expectNone(
      (request) =>
        request.url === `/api/workspaces/${workspaceId}/projects` && request !== post.request,
    );

    post.flush(successEnvelope, { status: 201, statusText: 'Created' });
    await Promise.resolve();
    const confirmation = http.expectOne(`/api/projects/${projectId}`);
    expect(confirmation.request.method).toBe('GET');
    expect(confirmation.request.withCredentials).toBe(true);
    confirmation.flush(projectConfirmation);
    await expect(create).resolves.toBe(true);
    expect(projects.retryProjects).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalledWith(['/projects', projectId]);
    expect(facade.createState()).toMatchObject({
      status: 'succeeded',
      createdProjectId: projectId,
      requestId: 'request-create',
    });
  });

  it('reuses one key for unchanged uncertain retries and rotates it for payload changes', async () => {
    await loadOptions();

    const first = facade.createProject(workspaceId, input);
    const firstPost = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    const firstKey = firstPost.request.headers.get('Idempotency-Key');
    firstPost.flush(null, { status: 503, statusText: 'Service Unavailable' });
    await expect(first).resolves.toBe(false);
    expect(facade.createState().message).toContain('may have been created');

    facade.resetCreatePresentation();
    const retry = facade.createProject(workspaceId, { ...input, title: ` ${input.title} ` });
    const retryPost = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    expect(retryPost.request.headers.get('Idempotency-Key')).toBe(firstKey);
    retryPost.flush(null, { status: 503, statusText: 'Service Unavailable' });
    await retry;

    facade.resetCreatePresentation();
    const changed = facade.createProject(workspaceId, { ...input, title: 'Changed title' });
    const changedPost = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    expect(changedPost.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    changedPost.flush(null, { status: 503, statusText: 'Service Unavailable' });
    await changed;
  });

  it('retains the same key after a malformed HTTP 201', async () => {
    await loadOptions();

    const first = facade.createProject(workspaceId, input);
    const firstPost = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    const firstKey = firstPost.request.headers.get('Idempotency-Key');
    firstPost.flush(
      { requestId: 'request-create', warnings: [] },
      { status: 201, statusText: 'Created' },
    );
    await first;

    facade.resetCreatePresentation();
    const retry = facade.createProject(workspaceId, input);
    const retryPost = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    expect(retryPost.request.headers.get('Idempotency-Key')).toBe(firstKey);
    retryPost.flush(null, { status: 503, statusText: 'Service Unavailable' });
    await retry;
  });

  it('uses refresh/navigation-only recovery after a strict 201 and never repeats POST', async () => {
    await loadOptions();
    router.navigate.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const create = facade.createProject(workspaceId, input);
    http
      .expectOne(`/api/workspaces/${workspaceId}/projects`)
      .flush(successEnvelope, { status: 201, statusText: 'Created' });
    await Promise.resolve();
    http.expectOne(`/api/projects/${projectId}`).flush(projectConfirmation);
    await expect(create).resolves.toBe(false);
    expect(facade.createState().status).toBe('committedPendingNavigation');

    await expect(facade.createProject(workspaceId, input)).resolves.toBe(false);
    http.expectNone(
      (request) =>
        request.url === `/api/workspaces/${workspaceId}/projects` && request.method === 'POST',
    );

    const retryNavigation = facade.retryCreatedProjectNavigation();
    http.expectOne(`/api/projects/${projectId}`).flush(projectConfirmation);
    await expect(retryNavigation).resolves.toBe(true);
    expect(projects.retryProjects).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledTimes(2);
    http.expectNone(
      (request) =>
        request.url === `/api/workspaces/${workspaceId}/projects` && request.method === 'POST',
    );
  });

  it('keeps committed recovery when own-command authorization invalidation wins the navigation race', async () => {
    await loadOptions();
    let resolveNavigation!: (value: boolean) => void;
    router.navigate.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveNavigation = resolve;
      }),
    );

    const create = facade.createProject(workspaceId, input);
    http
      .expectOne(`/api/workspaces/${workspaceId}/projects`)
      .flush(successEnvelope, { status: 201, statusText: 'Created' });
    await Promise.resolve();
    http.expectOne(`/api/projects/${projectId}`).flush(projectConfirmation);
    await Promise.resolve();
    expect(router.navigate).toHaveBeenCalledOnce();

    protectedClearer?.('authorization');
    resolveNavigation(true);
    await expect(create).resolves.toBe(false);
    expect(facade.options().status).toBe('idle');
    expect(facade.createState().status).toBe('committedPendingNavigation');
    http.expectNone(
      (request) =>
        request.url === `/api/workspaces/${workspaceId}/projects` && request.method === 'POST',
    );

    router.navigate.mockResolvedValueOnce(true);
    const retry = facade.retryCreatedProjectNavigation();
    http.expectOne(`/api/projects/${projectId}`).flush(projectConfirmation);
    await expect(retry).resolves.toBe(true);
    expect(router.navigate).toHaveBeenCalledTimes(2);
  });

  it('reuses the same key when authorization invalidation precedes the committed HTTP response', async () => {
    await loadOptions();

    const first = facade.createProject(workspaceId, input);
    const firstPost = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    const firstKey = firstPost.request.headers.get('Idempotency-Key');

    // The command may already be committed server-side even though its 201 is
    // still in flight. Authorization invalidation must cancel this response
    // without converting an unchanged retry into a new create identity.
    protectedClearer?.('authorization');
    await expect(first).resolves.toBe(false);
    expect(firstPost.cancelled).toBe(true);
    expect(facade.options().status).toBe('error');
    expect(facade.createState().message).toContain('may have been created');

    const optionsReload = facade.loadOptions(workspaceId);
    http
      .expectOne(`/api/workspaces/${workspaceId}/projects/create-options`)
      .flush(optionsEnvelope);
    await expect(optionsReload).resolves.toBe(true);

    const retry = facade.createProject(workspaceId, { ...input, title: ` ${input.title} ` });
    const retryPost = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    expect(retryPost.request.headers.get('Idempotency-Key')).toBe(firstKey);
    retryPost.flush(successEnvelope, { status: 201, statusText: 'Created' });
    await Promise.resolve();
    http.expectOne(`/api/projects/${projectId}`).flush(projectConfirmation);
    await expect(retry).resolves.toBe(true);
  });

  it('preserves an authorization-race commit even if another clearer already hid ActiveWorkspace, then destroys it on the actual Workspace boundary', async () => {
    await loadOptions();
    let resolveNavigation!: (value: boolean) => void;
    router.navigate.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveNavigation = resolve;
      }),
    );

    const create = facade.createProject(workspaceId, input);
    http
      .expectOne(`/api/workspaces/${workspaceId}/projects`)
      .flush(successEnvelope, { status: 201, statusText: 'Created' });
    await Promise.resolve();
    http.expectOne(`/api/projects/${projectId}`).flush(projectConfirmation);
    await Promise.resolve();

    // Protected clearers can run in a different registration order. The
    // authorization callback must not depend on another facade still exposing
    // ActiveWorkspace.
    activeWorkspace.set(null);
    protectedClearer?.('authorization');
    resolveNavigation(true);
    await expect(create).resolves.toBe(false);
    expect(facade.createState().status).toBe('committedPendingNavigation');

    protectedClearer?.('workspace');
    expect(facade.createState().status).toBe('idle');
    await expect(facade.retryCreatedProjectNavigation()).resolves.toBe(false);
    http.expectNone(
      (request) =>
        request.url === `/api/workspaces/${workspaceId}/projects` && request.method === 'POST',
    );
  });

  it('keeps one committed POST when confirmation GET fails across close and reopen', async () => {
    await loadOptions();

    const create = facade.createProject(workspaceId, input);
    http
      .expectOne(`/api/workspaces/${workspaceId}/projects`)
      .flush(successEnvelope, { status: 201, statusText: 'Created' });
    await Promise.resolve();
    http
      .expectOne(`/api/projects/${projectId}`)
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    await expect(create).resolves.toBe(false);
    expect(facade.createState().status).toBe('committedPendingNavigation');

    // The own-command invalidation can hide capability/options before the user
    // closes. Reopening must still expose GET/navigation-only recovery.
    protectedClearer?.('authorization');
    expect(facade.options().status).toBe('idle');
    facade.resetCreatePresentation();
    await expect(facade.createProject(workspaceId, input)).resolves.toBe(false);
    http.expectNone(
      (request) =>
        request.url === `/api/workspaces/${workspaceId}/projects` && request.method === 'POST',
    );

    const retry = facade.retryCreatedProjectNavigation();
    http.expectOne(`/api/projects/${projectId}`).flush(projectConfirmation);
    await expect(retry).resolves.toBe(true);
  });

  it('rejects disallowed Groups and date inversion before sending a request', async () => {
    await loadOptions();

    await expect(
      facade.createProject(workspaceId, {
        ...input,
        groupId: secondWorkspaceId,
        endDate: '2026-08-20',
      }),
    ).resolves.toBe(false);
    expect(facade.createState().fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'groupId' }),
        expect.objectContaining({ field: 'endDate' }),
      ]),
    );
    http.expectNone(`/api/workspaces/${workspaceId}/projects`);
  });

  it('cancels and clears an in-flight protected mutation at an authorization boundary', async () => {
    await loadOptions();
    const create = facade.createProject(workspaceId, input);
    const post = http.expectOne(`/api/workspaces/${workspaceId}/projects`);

    protectedClearer?.('workspace');
    await expect(create).resolves.toBe(false);
    expect(post.cancelled).toBe(true);
    expect(facade.options().status).toBe('idle');
    expect(facade.createState().status).toBe('idle');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('drops the active scope when authenticated identity or Workspace changes', async () => {
    await loadOptions();

    authSession.set({
      isAuthenticated: true,
      currentTenant: { tenantId: 'tenant-a' },
      currentUser: { userId: 'user-b' },
    });
    TestBed.flushEffects();
    expect(facade.options().status).toBe('idle');

    activeWorkspace.set({ id: secondWorkspaceId, label: 'Other Workspace' });
    TestBed.flushEffects();
    expect(facade.createState().status).toBe('idle');
  });
});
