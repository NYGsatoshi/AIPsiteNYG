import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { ContinueWorkingHistoryService } from '../../shared/continue-working/continue-working-history.service';
import { EMPTY } from 'rxjs';
import { MyTasksFacade } from './my-tasks.facade';
import { ProjectsFacade } from './projects.facade';
import { provideHttpClient } from '@angular/common/http';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import type { TaskDto } from './projects.api';
import { TestBed } from '@angular/core/testing';

let activeWorkspace: ActiveWorkspaceFacade, facade: ProjectsFacade, http: HttpTestingController;

const cleanup = vi.fn<() => void>(),
  configureFacade = (): void => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: RealtimeFacade,
          useValue: {
            durableEvents$: EMPTY,
            registerCatchUp: registerCleanup,
            registerProtectedStateClearer: registerCleanup,
            registerSubscription: registerCleanup,
          },
        },
        { provide: MyTasksFacade, useValue: { refreshIfLoaded: vi.fn() } },
        { provide: ContinueWorkingHistoryService, useValue: { touchProject: vi.fn() } },
      ],
    });
    activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    facade = TestBed.inject(ProjectsFacade);
    http = TestBed.inject(HttpTestingController);
  },
  detail = {
    checklist: [],
    comments: { items: [] },
    files: { items: [] },
    labels: [],
    subtasks: { items: [] },
    task: {
      id: 'task-1',
      priority: 2,
      progressPercent: 0,
      projectId: 'project-1',
      status: 1,
      title: 'Hydration race task',
      uiPermissions: {
        allowedTransitions: [],
        canAssign: false,
        canChangeStatus: false,
        canDelete: false,
        canEdit: true,
      },
      workspaceId: 'workspace-1',
    } satisfies TaskDto,
  },
  expectAuthorizedDetail = (): void => {
    expect(facade.getTaskDetail('project-1', 'task-1')).toMatchObject({
      project: { id: 'project-1', name: 'Hydration race project' },
      status: 'ready',
      task: { id: 'task-1', title: 'Hydration race task' },
    });
  },
  flushColdReadAcrossHydration = (): void => {
    facade.ensureTaskDetail('project-1', 'task-1');
    const coldTaskRead = http.expectOne('/api/tasks/task-1');
    activeWorkspace.setActiveWorkspace({ id: 'workspace-1', label: 'Workspace 1' });
    coldTaskRead.flush(detail);
    http.expectNone('/api/projects/project-1');
    expect(facade.getTaskDetail('project-1', 'task-1').detail).toBeUndefined();
  },
  flushReauthorizedRead = (): void => {
    TestBed.tick();
    http.expectOne('/api/tasks/task-1').flush(detail);
    http.expectOne('/api/projects/project-1').flush(project);
  },
  project = {
    id: 'project-1',
    status: 1,
    title: 'Hydration race project',
    uiPermissions: { canCreateTask: true },
    workspaceId: 'workspace-1',
  },
  registerCleanup = (): (() => void) => cleanup;

describe('ProjectsFacade direct-route Workspace hydration', () => {
  beforeEach(() => {
    cleanup.mockClear();
    configureFacade();
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('keeps the cold Task read bound to its initial null Workspace and performs one parent Project read after hydration', () => {
    flushColdReadAcrossHydration();
    flushReauthorizedRead();
    expectAuthorizedDetail();
  });
});
