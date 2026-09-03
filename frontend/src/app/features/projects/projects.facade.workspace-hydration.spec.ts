import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EMPTY } from 'rxjs';

import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { ContinueWorkingHistoryService } from '../../shared/continue-working/continue-working-history.service';
import { MyTasksFacade } from './my-tasks.facade';
import { ProjectsFacade } from './projects.facade';
import { TaskDto } from './projects.api';

const task: TaskDto = {
  id: 'task-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  title: 'Hydration race task',
  status: 1,
  priority: 2,
  progressPercent: 0,
  uiPermissions: {
    canEdit: true,
    canAssign: false,
    canChangeStatus: false,
    canDelete: false,
    allowedTransitions: [],
  },
};

const detail = {
  task,
  checklist: [],
  labels: [],
  subtasks: { items: [] },
  comments: { items: [] },
  files: { items: [] },
};

const project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  title: 'Hydration race project',
  status: 1,
  uiPermissions: { canCreateTask: true },
};

describe('ProjectsFacade direct-route Workspace hydration', () => {
  let facade: ProjectsFacade;
  let activeWorkspace: ActiveWorkspaceFacade;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: RealtimeFacade,
          useValue: {
            durableEvents$: EMPTY,
            registerProtectedStateClearer: () => () => undefined,
            registerSubscription: () => () => undefined,
            registerCatchUp: () => () => undefined,
          },
        },
        { provide: MyTasksFacade, useValue: { refreshIfLoaded: vi.fn() } },
        { provide: ContinueWorkingHistoryService, useValue: { touchProject: vi.fn() } },
      ],
    });

    activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    facade = TestBed.inject(ProjectsFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('keeps the cold Task read bound to its initial null Workspace and performs one parent Project read after hydration', () => {
    facade.ensureTaskDetail('project-1', 'task-1');
    const coldTaskRead = http.expectOne('/api/tasks/task-1');

    // Reproduce the production race: Workspace selection commits after the
    // Task request starts but before its response reaches the switchMap.
    activeWorkspace.setActiveWorkspace({ id: 'workspace-1', label: 'Workspace 1' });
    coldTaskRead.flush(detail);

    // The cold request was authorized under a null Workspace snapshot. It must
    // remain undisclosed and must not opportunistically adopt the newer scope.
    http.expectNone('/api/projects/project-1');
    expect(facade.getTaskDetail('project-1', 'task-1').detail).toBeUndefined();

    // The Workspace effect owns the new authorization generation and starts a
    // fresh read bound to Workspace 1.
    TestBed.flushEffects();
    const reauthorizedTaskRead = http.expectOne('/api/tasks/task-1');
    reauthorizedTaskRead.flush(detail);

    const parentProjectRead = http.expectOne('/api/projects/project-1');
    parentProjectRead.flush(project);

    http.expectNone((request) => request.url === '/api/projects' && request.params.has('workspaceId'));
    expect(facade.getTaskDetail('project-1', 'task-1')).toMatchObject({
      status: 'ready',
      project: { id: 'project-1', name: 'Hydration race project' },
      task: { id: 'task-1', title: 'Hydration race task' },
    });
  });
});
