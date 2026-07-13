import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { MyTasksFacade } from './my-tasks.facade';

const assignedTaskDto = {
  taskId: 'task-2',
  projectId: 'project-1',
  projectTitle: 'Backend Project',
  title: 'Assigned Backend Task',
  dueDate: '2026-07-21',
  status: 0,
  priority: 1,
  isOverdue: false
};

describe('MyTasksFacade', () => {
  let facade: MyTasksFacade;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    facade = TestBed.inject(MyTasksFacade);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('loads /api/me/tasks directly without requesting projects', () => {
    facade.load();

    const request = httpMock.expectOne('/api/me/tasks');
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    httpMock.expectNone('/api/projects');
    request.flush({ items: [assignedTaskDto], page: 1, pageSize: 50, totalCount: 1 });

    const page = facade.getMyTasks();
    expect(page.status).toBe('ready');
    expect(page.rows.map((row) => `${row.project}:${row.title}`)).toEqual([
      'Backend Project:Assigned Backend Task'
    ]);
  });

  it('does not duplicate requests when load is called repeatedly', () => {
    facade.load();
    facade.load();

    httpMock.expectOne('/api/me/tasks').flush({ items: [assignedTaskDto] });
    httpMock.expectNone('/api/me/tasks');
  });

  it('renders an explicit empty state for an empty assigned-task page', () => {
    facade.load();
    httpMock.expectOne('/api/me/tasks').flush({ items: [], page: 1, pageSize: 50, totalCount: 0 });

    const page = facade.getMyTasks();
    expect(page.status).toBe('empty');
    expect(page.rows).toEqual([]);
  });

  it.each([401, 403])('renders permission denied for %s responses', (status) => {
    facade.load();
    httpMock
      .expectOne('/api/me/tasks')
      .flush({ error: 'Authentication is required.' }, { status, statusText: 'Auth failure' });

    expect(facade.getMyTasks().status).toBe('permissionDenied');
    expect(facade.getMyTasks().message).toContain('Authentication');
  });

  it('renders a retryable error for server or network failures', () => {
    facade.load();
    httpMock
      .expectOne('/api/me/tasks')
      .flush({ message: 'Internal failure', traceId: 'trace-tasks' }, { status: 500, statusText: 'Server Error' });

    expect(facade.getMyTasks().status).toBe('error');
    expect(facade.getMyTasks().error?.requestId).toBe('trace-tasks');

    facade.retry();
    httpMock.expectOne('/api/me/tasks').flush({ items: [assignedTaskDto] });

    expect(facade.getMyTasks().status).toBe('ready');
  });

  it('rejects DTO rows that do not include required identifiers', () => {
    facade.load();
    httpMock.expectOne('/api/me/tasks').flush({
      items: [{ projectId: 'project-1', projectTitle: 'Backend Project', title: 'Missing ID' }]
    });

    expect(facade.getMyTasks().status).toBe('error');
    expect(facade.getMyTasks().rows).toEqual([]);
  });
});
