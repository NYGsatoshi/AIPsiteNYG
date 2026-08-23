import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { AIP_AUTH_SESSION_MOCK, DEFAULT_AUTH_SESSION } from '../../core/auth/auth-session.facade';
import { NotificationOpenContextService } from '../../core/notifications/notification-open-context.service';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { WorkspaceSelectionFacade } from '../../core/workspace/workspace-selection.facade';
import { MyTasksFacade } from './my-tasks.facade';

const task = {
  taskId: 'task-2', tenantId: 'tenant-1', workspaceId: 'workspace-1', workspaceTitle: 'Backend workspace',
  projectId: 'project-1', projectTitle: 'Backend Project', title: 'Assigned Backend Task',
  workflowStageName: 'Todo', stageCategory: 'Todo', priority: 'Medium', isBlocked: false,
  progressPercent: 0, timeGroup: 'Today', isOverdue: false, version: 1,
  checklistCompletedCount: 0, checklistTotalCount: 0, labels: [], quickEditPermissions: { canClaim: false, canChangeStage: true }, warnings: []
};

describe('MyTasksFacade', () => {
  let facade: MyTasksFacade;
  let httpMock: HttpTestingController;
  let activeWorkspace: ActiveWorkspaceFacade;
  let router: { url: string; navigateByUrl: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    router = {
      url: '/workspaces',
      navigateByUrl: vi.fn(async (url: string) => {
        router.url = url;
        return true;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // The HTTP projection is valid only for an authenticated session. A
        // disabled realtime transport must not be modeled as a logout.
        { provide: AIP_AUTH_SESSION_MOCK, useValue: DEFAULT_AUTH_SESSION },
        { provide: Router, useValue: router },
      ],
    });
    activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    TestBed.inject(WorkspaceSelectionFacade).reconcileAuthorizedWorkspaces(
      [
        { id: 'workspace-1', label: 'Workspace one' },
        { id: 'workspace-2', label: 'Workspace two' },
      ],
      { tenantId: 'tenant-1', userId: 'user-1' },
      'workspace-1',
    );
    facade = TestBed.inject(MyTasksFacade);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('loads the canonical projection and counts using an explicit relationship view', () => {
    facade.load();
    flush({ items: [task], page: 1, pageSize: 50, totalCount: 1 }, { views: [{ view: 'Assigned', count: 1 }], timeGroups: [{ timeGroup: 'Today', count: 1 }] });

    const page = facade.getMyTasks();
    expect(page.status).toBe('ready');
    expect(page.tasks[0].workspaceTitle).toBe('Backend workspace');
    expect(page.counts.find((item) => item.key === 'assigned')?.count).toBe(1);
    expect(page.counts.find((item) => item.key === 'today')?.count).toBe(1);
  });

  it('cancels/replaces the active query when the relationship tab changes', () => {
    facade.load();
    flush({ items: [], page: 1, pageSize: 50, totalCount: 0 }, { views: [], timeGroups: [] });
    facade.setTab('watching');
    const requests = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(requests).toHaveLength(2);
    expect(requests[0].request.params.get('view')).toBe('watching');
    requests.find((request) => request.request.url === '/api/me/tasks')!.flush({ items: [], page: 1, pageSize: 50, totalCount: 0 });
    requests.find((request) => request.request.url === '/api/me/tasks/counts')!.flush({ views: [], timeGroups: [] });
  });

  it('rejects incomplete canonical rows rather than falling back to a legacy mock record', () => {
    facade.load();
    flush({ items: [{ taskId: 'task-1', title: 'Incomplete' }], page: 1, pageSize: 50, totalCount: 1 }, { views: [], timeGroups: [] });
    expect(facade.getMyTasks().status).toBe('error');
  });

  it('does not issue the current-workspace request until an explicit active workspace is available', () => {
    activeWorkspace.clearWorkspace();
    TestBed.flushEffects();
    facade.load();
    httpMock.expectNone('/api/me/tasks');
    httpMock.expectNone('/api/me/tasks/counts');

    activeWorkspace.setActiveWorkspace({ id: 'workspace-explicit', label: 'Explicit workspace' });
    TestBed.flushEffects();
    const requests = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.request.params.get('workspaceId') === 'workspace-explicit')).toBe(true);
    requests[0].flush({ items: [], page: 1, pageSize: 50, totalCount: 0 });
    requests[1].flush({ views: [], timeGroups: [] });
  });

  it('maps filters and server paging into canonical query parameters and resets the page', () => {
    facade.load();
    flush({ items: [], page: 1, pageSize: 50, totalCount: 60 }, { views: [], timeGroups: [] });

    facade.nextPage();
    let requests = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(requests[0].request.params.get('page')).toBe('2');
    requests[0].flush({ items: [], page: 2, pageSize: 50, totalCount: 60 });
    requests[1].flush({ views: [], timeGroups: [] });

    facade.setPriorityFilter('critical');
    requests = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(requests[0].request.params.get('page')).toBe('1');
    expect(requests[0].request.params.get('priority')).toBe('critical');
    requests[0].flush({ items: [], page: 1, pageSize: 50, totalCount: 0 });
    requests[1].flush({ views: [], timeGroups: [] });
  });

  it('clears and cancels the prior workspace request before loading the newly selected workspace', () => {
    facade.load();
    const prior = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');

    facade.setWorkspace('workspace-2');
    TestBed.flushEffects();

    expect(prior.every((request) => request.cancelled)).toBe(true);
    expect(facade.getMyTasks().tasks).toEqual([]);
    expect(facade.getMyTasks().counts).toEqual([]);
    expect(facade.getMyTasks().page).toBe(1);
    const current = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(current).toHaveLength(2);
    expect(current.every((request) => request.request.params.get('workspaceId') === 'workspace-2')).toBe(true);
    current.find((request) => request.request.url === '/api/me/tasks')!
      .flush({ items: [], page: 1, pageSize: 50, totalCount: 0 });
    current.find((request) => request.request.url === '/api/me/tasks/counts')!
      .flush({ views: [], timeGroups: [] });
  });

  it('returns the page-level Workspace control to My Tasks only after a safe neutral transition', async () => {
    router.url = '/tasks';

    facade.setWorkspace('workspace-2');

    await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledTimes(2));
    expect(router.navigateByUrl).toHaveBeenNthCalledWith(1, '/workspaces');
    expect(router.navigateByUrl).toHaveBeenNthCalledWith(2, '/tasks');
    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-2');
    expect(facade.getMyTasks().workspaceId).toBe('workspace-2');
  });

  it('leaves the neutral Workspace route in place when returning to My Tasks is canceled', async () => {
    router.url = '/tasks';
    router.navigateByUrl = vi.fn(async (url: string) => {
      if (url === '/workspaces') {
        router.url = url;
        return true;
      }
      return false;
    });

    facade.setWorkspace('workspace-2');

    await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledTimes(2));
    expect(router.url).toBe('/workspaces');
    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-2');
    expect(facade.getMyTasks().workspaceId).toBe('workspace-2');
  });

  it('repairs a stale My Tasks return when a newer Workspace wins during navigation', async () => {
    router.url = '/tasks';
    let resolveTaskNavigation!: (navigated: boolean) => void;
    const taskNavigation = new Promise<boolean>((resolve) => {
      resolveTaskNavigation = resolve;
    });
    router.navigateByUrl = vi.fn(async (url: string) => {
      if (url === '/workspaces') {
        router.url = url;
        return true;
      }

      const navigated = await taskNavigation;
      if (navigated) {
        router.url = url;
      }
      return navigated;
    });

    facade.setWorkspace('workspace-2');
    await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledTimes(2));

    await TestBed.inject(WorkspaceSelectionFacade).selectWorkspace('workspace-1');
    resolveTaskNavigation(true);

    await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledTimes(3));
    expect(router.navigateByUrl).toHaveBeenNthCalledWith(3, '/workspaces');
    expect(router.url).toBe('/workspaces');
    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-1');
  });

  it('DigestOpenAppliesWorkspaceSpecificMyTasksContextAfterFacadeAlreadyExists', async () => {
    const context = TestBed.inject(NotificationOpenContextService);
    const selection = TestBed.inject(WorkspaceSelectionFacade);

    await selection.selectWorkspace('workspace-2');
    context.setDigestWorkspace('workspace-2');
    TestBed.flushEffects();

    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-2');
    expect(facade.getMyTasks().workspaceId).toBe('workspace-2');
    expect(context.takeDigestWorkspace()).toBeNull();
  });

  it('clears protected rows, scope IDs, and active HTTP before a new Workspace is selected', () => {
    facade.load();
    const prior = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');

    TestBed.inject(RealtimeFacade).clearForWorkspaceBoundary();

    expect(prior.every((request) => request.cancelled)).toBe(true);
    expect(facade.getMyTasks().tasks).toEqual([]);
    expect(facade.getMyTasks().counts).toEqual([]);
    expect(facade.getMyTasks().totalCount).toBe(0);
    expect(facade.getMyTasks().workspaceId).toBeNull();
    expect(facade.getMyTasks().page).toBe(1);
    expect(activeWorkspace.activeWorkspace()).toBeNull();
    httpMock.expectNone('/api/me/tasks');
    httpMock.expectNone('/api/me/tasks/counts');

    activeWorkspace.setActiveWorkspace({ id: 'workspace-2', label: 'Workspace two' });
    TestBed.flushEffects();
    const requests = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.request.params.get('workspaceId') === 'workspace-2')).toBe(true);
    requests[0].flush({ items: [], page: 1, pageSize: 50, totalCount: 0 });
    requests[1].flush({ views: [], timeGroups: [] });
  });

  it('coalesces TaskChanged realtime events into one My Tasks refetch', () => {
    vi.useFakeTimers();
    facade.load();
    flush({ items: [task], page: 1, pageSize: 50, totalCount: 1 }, { views: [{ view: 'Assigned', count: 1 }], timeGroups: [] });

    const handleRealtimeEvent = (facade as unknown as { handleRealtimeEvent(event: unknown): void }).handleRealtimeEvent.bind(facade);
    handleRealtimeEvent({ eventType: 'Projects.TaskChanged.v1' });
    handleRealtimeEvent({ eventType: 'Projects.TaskChanged.v1' });

    vi.advanceTimersByTime(149);
    httpMock.expectNone('/api/me/tasks');
    httpMock.expectNone('/api/me/tasks/counts');

    vi.advanceTimersByTime(1);
    const requests = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(requests).toHaveLength(2);
    requests.find((request) => request.request.url === '/api/me/tasks')!
      .flush({ items: [task], page: 1, pageSize: 50, totalCount: 1 });
    requests.find((request) => request.request.url === '/api/me/tasks/counts')!
      .flush({ views: [{ view: 'Assigned', count: 1 }], timeGroups: [] });
  });

  function flush(page: unknown, counts: unknown): void {
    const requests = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(requests).toHaveLength(2);
    const taskRequest = requests.find((request) => request.request.url === '/api/me/tasks')!;
    expect(taskRequest.request.params.get('view')).toBe('assigned');
    expect(taskRequest.request.params.get('scope')).toBe('currentWorkspace');
    expect(taskRequest.request.params.get('workspaceId')).toBe('workspace-1');
    taskRequest.flush(page);
    requests.find((request) => request.request.url === '/api/me/tasks/counts')!.flush(counts);
  }
});
