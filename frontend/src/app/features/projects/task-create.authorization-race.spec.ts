import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { authSessionInterceptor } from '../../core/auth/auth-session.interceptor';
import { CsrfToken, CsrfTokenService } from '../../core/auth/csrf-token.service';
import {
  ProtectedStateClearReason,
  RealtimeFacade,
} from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { TaskCreateInput } from './task-create.api';
import { TaskCreateFacade } from './task-create.facade';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const taskId = '55555555-5555-4555-8555-555555555555';
const workflowStageId = '66666666-6666-4666-8666-666666666666';

const optionsEnvelope = {
  requestId: 'task-create-options-race',
  data: {
    projectId,
    workspaceId,
    projectTitle: 'Race Project',
    canCreateTask: true,
    canManageProject: true,
    milestones: [],
    assignees: [],
    projectScope: {
      policy: { webEnabled: false, projectFilesEnabled: false },
      version: 1,
      canSetTaskOverride: true,
    },
  },
  warnings: [],
};

const input: TaskCreateInput = {
  title: 'Race task',
  description: 'Authorization refresh races the create response.',
  priority: 'high',
  milestoneId: '',
  startDate: '2026-09-01',
  dueDate: '2026-09-02',
  goal: 'Preserve the dispatched idempotent request',
  deliverable: 'One committed Task and one navigation',
  constraints: 'Never send a second create POST',
  primaryAssigneeUserId: '',
  sourceScopeMode: 'Inherit',
  taskOverridePolicy: null,
};

const successEnvelope = {
  requestId: 'task-create-race-201',
  data: {
    taskId,
    projectId,
    workspaceId,
    milestoneId: null,
    primaryAssigneeUserId: null,
    title: input.title,
    priority: 2,
    status: 0,
    workflowStageId,
    version: 1,
    sourceScopeMode: 'Inherit',
    taskOverridePolicy: null,
  },
  warnings: [],
};

describe('TaskCreateFacade authorization/create race', () => {
  let facade: TaskCreateFacade;
  let http: HttpTestingController;
  let authSession: WritableSignal<Record<string, unknown>>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let protectedStateClearer: ((reason: ProtectedStateClearReason) => void) | null;

  beforeEach(() => {
    authSession = signal({
      isAuthenticated: true,
      currentTenant: { tenantId: 'tenant-a' },
      currentUser: { userId: 'user-a' },
    });
    router = { navigate: vi.fn().mockResolvedValue(true) };
    protectedStateClearer = null;
    const durableEvents = new Subject<DurableRealtimeEvent>();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authSessionInterceptor])),
        provideHttpClientTesting(),
        TaskCreateFacade,
        { provide: Router, useValue: router },
        {
          provide: AuthSessionFacade,
          useValue: {
            session: authSession,
            csrfCacheKey: () => 'tenant-a',
            refreshCurrentUser: () => of(null),
            handleTerminal401: vi.fn(),
          },
        },
        {
          provide: CsrfTokenService,
          useValue: {
            ensureToken: vi.fn(() =>
              of<CsrfToken>({
                token: 'csrf-task-create-race',
                headerName: 'X-CSRF-Token',
                cacheKey: 'tenant-a',
              }),
            ),
            clearToken: vi.fn(),
          },
        },
        {
          provide: ActiveWorkspaceFacade,
          useValue: { activeWorkspace: signal({ id: workspaceId, label: 'Race Workspace' }) },
        },
        {
          provide: RealtimeFacade,
          useValue: {
            durableEvents$: durableEvents.asObservable(),
            registerProtectedStateClearer: vi.fn(
              (_: string, clearer: (reason: ProtectedStateClearReason) => void) => {
                protectedStateClearer = clearer;
                return () => undefined;
              },
            ),
            registerSubscription: vi.fn(() => () => undefined),
            registerCatchUp: vi.fn(() => () => undefined),
          },
        },
      ],
    });

    facade = TestBed.inject(TaskCreateFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    facade.release();
    http.verify();
    TestBed.resetTestingModule();
  });

  it('does not abort a dispatched idempotent POST when authorization state refreshes', async () => {
    const load = facade.load(projectId);
    http.expectOne(`/api/projects/${projectId}/tasks/create-options`).flush(optionsEnvelope);
    await expect(load).resolves.toBe(true);

    const create = facade.createTask(input);
    const post = http.expectOne(`/api/projects/${projectId}/tasks/create`);
    expect(post.request.method).toBe('POST');
    expect(post.request.headers.get('Idempotency-Key')).toMatch(/^task-create-/u);
    expect(protectedStateClearer).not.toBeNull();

    protectedStateClearer!('authorization');

    expect(post.cancelled).toBe(false);
    expect(facade.options().data).toBeUndefined();
    expect(facade.createState().status).toBe('submitting');

    post.flush(successEnvelope, { status: 201, statusText: 'Created' });

    await expect(create).resolves.toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(['/projects', projectId, 'tasks', taskId]);
    expect(facade.createState()).toMatchObject({
      status: 'succeeded',
      createdTaskId: taskId,
      requestId: 'task-create-race-201',
    });
    http.expectNone((request) =>
      request.method === 'POST' && request.url === `/api/projects/${projectId}/tasks/create`,
    );
  });
});
