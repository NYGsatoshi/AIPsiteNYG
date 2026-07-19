import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

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

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    facade = TestBed.inject(MyTasksFacade);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => { httpMock.verify(); TestBed.resetTestingModule(); });

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

  function flush(page: unknown, counts: unknown): void {
    const requests = httpMock.match((request) => request.url === '/api/me/tasks' || request.url === '/api/me/tasks/counts');
    expect(requests).toHaveLength(2);
    const taskRequest = requests.find((request) => request.request.url === '/api/me/tasks')!;
    expect(taskRequest.request.params.get('view')).toBe('assigned');
    expect(taskRequest.request.params.get('scope')).toBe('currentWorkspace');
    taskRequest.flush(page);
    requests.find((request) => request.request.url === '/api/me/tasks/counts')!.flush(counts);
  }
});
