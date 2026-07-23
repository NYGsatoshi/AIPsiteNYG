import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ProjectsFacade } from './projects.facade';
import { TaskDto } from './projects.api';

const projectDto = {
  id: 'project-1',
  title: 'Backend Project',
  status: 1,
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  uiPermissions: { canCreateTask: true }
};

const editableTaskDto: TaskDto = {
  id: 'task-1',
  projectId: 'project-1',
  title: 'Backend Task',
  description: 'Persisted detail',
  status: 1,
  priority: 2,
  startDate: '2026-07-02',
  dueDate: '2026-07-20',
  progressPercent: 30,
  uiPermissions: {
    canEdit: true,
    canAssign: true,
    canChangeStatus: false,
    canDelete: true,
    allowedTransitions: []
  }
};

describe('ProjectsFacade live API mutations', () => {
  let facade: ProjectsFacade;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    facade = TestBed.inject(ProjectsFacade);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('loads project tasks without requiring My Tasks endpoint', () => {
    flushInitialLoad();

    const projectRows = facade.getProjectsOverview().rows;

    expect(projectRows.map((row) => row.id)).toEqual(['task-1']);
    httpMock.expectNone('/api/me/tasks');
  });

  it('fetches task detail by id when the task is not present in the project list page', () => {
    flushInitialLoad([]);

    expect(facade.getTaskDetail('project-1', 'task-1').status).toBe('empty');
    facade.ensureTaskDetail('project-1', 'task-1');

    httpMock.expectOne('/api/tasks/task-1').flush(editableTaskDto);

    expect(facade.getTaskDetail('project-1', 'task-1').editorTask?.title).toBe('Backend Task');
  });

  it('does not render cached task content when the route project context mismatches the loaded task', () => {
    flushInitialLoad([]);
    facade.ensureTaskDetail('wrong-project', 'task-1');

    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });

    const page = facade.getTaskDetail('wrong-project', 'task-1');
    expect(page.status).toBe('empty');
    expect(page.task).toBeUndefined();
    expect(page.editorTask).toBeUndefined();
    expect(page.message).toBe('TASK_DETAIL_PROJECT_MISMATCH');
  });

  it('creates a task through the backend and refreshes project and my-task rows after success', () => {
    flushInitialLoad();

    facade.createTask({
      projectId: 'project-1',
      title: 'Created Task',
      description: 'Created through UI',
      priority: 'high',
      startDate: '2026-07-05',
      dueDate: '2026-07-25'
    });

    const create = httpMock.expectOne('/api/projects/project-1/tasks');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({
      milestoneId: null,
      title: 'Created Task',
      description: 'Created through UI',
      priority: 2,
      startDate: '2026-07-05',
      dueDate: '2026-07-25'
    });
    create.flush({ ...editableTaskDto, id: 'task-created', title: 'Created Task' });

    httpMock.expectOne('/api/projects/project-1/tasks').flush({
      items: [{ ...editableTaskDto, id: 'task-created', title: 'Created Task' }]
    });

    expect(facade.getTaskCreateMutationState().status).toBe('success');
    expect(facade.getProjectsOverview().rows.map((row) => row.title)).toEqual(['Created Task']);
  });

  it('saves a task through PATCH and refreshes detail/list state after success', () => {
    flushInitialLoad();

    facade.saveTask('task-1', 'project-1', {
      title: 'Saved Task',
      description: 'Saved detail',
      priority: 'urgent',
      startDate: '2026-07-03',
      dueDate: '2026-07-22',
      progressPercent: 65
    });

    const save = httpMock.expectOne('/api/tasks/task-1');
    expect(save.request.method).toBe('PATCH');
    expect(save.request.body).toEqual({
      title: 'Saved Task',
      description: 'Saved detail',
      priority: 3,
      startDate: '2026-07-03',
      dueDate: '2026-07-22',
      progressPercent: 65
    });
    save.flush({ ...editableTaskDto, title: 'Saved Task', progressPercent: 65 });

    httpMock.expectOne('/api/tasks/task-1').flush({
      ...editableTaskDto,
      title: 'Saved Task',
      progressPercent: 65
    });
    httpMock.expectOne('/api/projects/project-1/tasks').flush({
      items: [{ ...editableTaskDto, title: 'Saved Task', progressPercent: 65 }]
    });

    expect(facade.getTaskMutationState().status).toBe('success');
    expect(facade.getTaskDetail('project-1', 'task-1').editorTask?.title).toBe('Saved Task');
    expect(facade.getProjectsOverview().rows[0].progressPercent).toBe(65);
  });

  it('keeps task state unchanged and shows a safe backend error when save fails', () => {
    flushInitialLoad();

    facade.saveTask('task-1', 'project-1', {
      title: 'Rejected Task',
      description: 'Rejected detail',
      priority: 'medium',
      startDate: '2026-07-02',
      dueDate: '2026-07-20',
      progressPercent: 45
    });

    httpMock.expectOne('/api/tasks/task-1').flush(
      { message: 'You are not allowed to update this task.', traceId: 'trace-123' },
      { status: 400, statusText: 'Bad Request' }
    );

    expect(facade.getTaskMutationState()).toEqual({
      status: 'failure',
      message: 'You are not allowed to update this task.',
      requestId: 'trace-123'
    });
    expect(facade.getTaskDetail('project-1', 'task-1').editorTask?.title).toBe('Backend Task');
  });

  it('shows a Project error state and retries without rendering an empty success state', () => {
    httpMock
      .expectOne('/api/projects')
      .flush({ message: 'server failed', traceId: 'trace-projects' }, { status: 500, statusText: 'Server Error' });

    expect(facade.getProjectsOverview().status).toBe('error');
    expect(facade.getProjectsOverview().projects).toEqual([]);
    expect(facade.getProjectsOverview().error?.requestId).toBe('trace-projects');

    facade.retryProjects();
    flushInitialLoad();

    expect(facade.getProjectsOverview().status).toBe('ready');
    expect(facade.getProjectsOverview().projects.map((project) => project.id)).toEqual(['project-1']);
  });

  it('shows a Project error state when a project task list request fails', () => {
    httpMock.expectOne('/api/projects').flush({ items: [projectDto] });
    httpMock
      .expectOne('/api/projects/project-1/tasks')
      .flush({ message: 'Task list failed', traceId: 'trace-tasks' }, { status: 500, statusText: 'Server Error' });

    const page = facade.getProjectsOverview();
    expect(page.status).toBe('error');
    expect(page.rows).toEqual([]);
    expect(page.error?.requestId).toBe('trace-tasks');
  });

  it('does not report task creation success after backend mutation failure', () => {
    flushInitialLoad();

    facade.createTask({
      projectId: 'project-1',
      title: 'Rejected Task',
      description: '',
      priority: 'medium',
      startDate: '',
      dueDate: ''
    });

    httpMock
      .expectOne('/api/projects/project-1/tasks')
      .flush({ message: 'Create rejected.', traceId: 'trace-create' }, { status: 500, statusText: 'Server Error' });

    expect(facade.getTaskCreateMutationState()).toEqual({
      status: 'failure',
      message: 'Create rejected.',
      requestId: 'trace-create'
    });
    expect(facade.getProjectsOverview().rows.map((row) => row.id)).toEqual(['task-1']);
  });

  function flushInitialLoad(projectTasks: readonly TaskDto[] = [editableTaskDto]): void {
    httpMock.expectOne('/api/projects').flush({ items: [projectDto] });
    httpMock.expectOne('/api/projects/project-1/tasks').flush({ items: projectTasks });
  }
});
