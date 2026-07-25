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

  it('cancels and discards an in-flight detail request after leaving the page', () => {
    flushInitialLoad([]);
    facade.ensureTaskDetail('project-1', 'task-1');
    const request = httpMock.expectOne('/api/tasks/task-1');

    facade.releaseTaskDetail();

    expect(request.cancelled).toBe(true);
    expect(facade.getTaskDetail('project-1', 'task-1').detail).toBeUndefined();
  });

  it('cancels Task A before Task B becomes active and never retains A detail', () => {
    flushInitialLoad([]);
    facade.ensureTaskDetail('project-1', 'task-1');
    const taskA = httpMock.expectOne('/api/tasks/task-1');
    facade.ensureTaskDetail('project-1', 'task-2');
    const taskB = httpMock.expectOne('/api/tasks/task-2');

    expect(taskA.cancelled).toBe(true);
    taskB.flush({ task: { ...editableTaskDto, id: 'task-2', title: 'Task B' }, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });

    expect(facade.getTaskDetail('project-1', 'task-1').detail).toBeUndefined();
    expect(facade.getTaskDetail('project-1', 'task-2').editorTask?.title).toBe('Task B');
  });

  it('loads project label definitions as soon as detail permissions allow labels', () => {
    flushInitialLoad([]);
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, permissions: { canApplyLabels: true }, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });

    const labels = httpMock.expectOne('/api/projects/project-1/task-labels?includeArchived=true');
    labels.flush([{ id: 'label-1', name: 'Urgent', sortKey: 1024, isArchived: false, version: 1 }]);

    expect(facade.getTaskDetail('project-1', 'task-1').detail?.labelDefinitions.map((label) => label.name)).toEqual(['Urgent']);
  });

  it('drops an obsolete project response after authorization changes and reloads the active task only after reauthorization', () => {
    const firstProjects = httpMock.expectOne('/api/projects');
    (facade as unknown as { handleRealtimeEvent(event: unknown): void }).handleRealtimeEvent(realtimeEvent('Security.AuthorizationStateChanged.v1'));
    const currentProjects = httpMock.expectOne('/api/projects');

    expect(firstProjects.cancelled).toBe(true);
    currentProjects.flush({ items: [projectDto] });
    httpMock.expectOne('/api/projects/project-1/tasks').flush({ items: [editableTaskDto] });

    expect(facade.getProjectsOverview().rows.map(row => row.id)).toEqual(['task-1']);
  });

  it('does not apply an obsolete save after Task A is replaced by Task B', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    facade.saveTask('task-1', 'project-1', { title: 'A edit', description: '', priority: 'medium', startDate: '', dueDate: '', progressPercent: 1, expectedVersion: '1' });
    const save = httpMock.expectOne('/api/tasks/task-1');

    facade.ensureTaskDetail('project-1', 'task-2');

    expect(save.cancelled).toBe(true);
    httpMock.expectOne('/api/tasks/task-2').flush({ task: { ...editableTaskDto, id: 'task-2', title: 'Task B' }, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    expect(facade.getTaskMutationState().status).toBe('idle');
    expect(facade.getTaskDetail('project-1', 'task-2').editorTask?.title).toBe('Task B');
  });

  it('exposes a retryable aggregate detail error instead of leaving the page in loading', () => {
    flushInitialLoad([]);
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ message: 'temporary failure', traceId: 'detail-500' }, { status: 500, statusText: 'Server Error' });

    expect(facade.getTaskDetail('project-1', 'task-1').detailSectionState).toMatchObject({ status: 'error', requestId: 'detail-500' });
    facade.retryTaskDetail('task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    expect(facade.getTaskDetail('project-1', 'task-1').detailSectionState.status).toBe('ready');
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
      progressPercent: 65,
      expectedVersion: '1'
    });

    const save = httpMock.expectOne('/api/tasks/task-1');
    expect(save.request.method).toBe('PATCH');
    expect(save.request.body).toEqual({
      title: 'Saved Task',
      description: 'Saved detail',
      priority: 3,
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-22',
      progressPercent: 65,
      expectedVersion: 1
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
      progressPercent: 45,
      expectedVersion: '1'
    });

    httpMock.expectOne('/api/tasks/task-1').flush(
      { message: 'You are not allowed to update this task.', traceId: 'trace-123' },
      { status: 400, statusText: 'Bad Request' }
    );

    expect(facade.getTaskMutationState()).toEqual({
      status: 'validation',
      message: 'You are not allowed to update this task.',
      requestId: 'trace-123'
    });
    expect(facade.getTaskDetail('project-1', 'task-1').editorTask?.title).toBe('Backend Task');
  });

  it('reports a successful save with a failed authoritative reload separately from a PATCH failure', () => {
    flushInitialLoad();
    facade.saveTask('task-1', 'project-1', { title: 'Saved', description: '', priority: 'medium', startDate: '', dueDate: '', progressPercent: 30, expectedVersion: '1' });
    httpMock.expectOne('/api/tasks/task-1').flush({ ...editableTaskDto, title: 'Saved' });
    const taskReload = httpMock.expectOne('/api/tasks/task-1');
    const listReload = httpMock.expectOne('/api/projects/project-1/tasks');
    taskReload.flush({ message: 'detail unavailable', traceId: 'after-save-500' }, { status: 500, statusText: 'Server Error' });
    expect(listReload.cancelled).toBe(true);
    expect(facade.getTaskMutationState()).toEqual({ status: 'savedButRefreshFailed', message: 'detail unavailable', requestId: 'after-save-500' });
  });

  it('maps both HTTP 409 and TASK_STALE_VERSION to a preserved task-save conflict', () => {
    flushInitialLoad();
    facade.saveTask('task-1', 'project-1', { title: 'Edited', description: '', priority: 'medium', startDate: '', dueDate: '', progressPercent: 1, expectedVersion: '1' });
    httpMock.expectOne('/api/tasks/task-1').flush({ code: 'TASK_STALE_VERSION', message: 'Task changed.', traceId: 'stale-1' }, { status: 409, statusText: 'Conflict' });

    expect(facade.getTaskMutationState()).toEqual({ status: 'conflict', message: 'Task changed.', requestId: 'stale-1' });
    expect(facade.getTaskDetail('project-1', 'task-1').editorTask?.title).toBe('Backend Task');
  });

  it('reloads the authoritative task after an explicit save-conflict recovery and keeps conflict on reload failure', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    facade.saveTask('task-1', 'project-1', { title: 'Edited', description: '', priority: 'medium', startDate: '', dueDate: '', progressPercent: 1, expectedVersion: '1' });
    httpMock.expectOne('/api/tasks/task-1').flush({ error: { code: 'TASK_STALE_VERSION', message: 'Stale' } }, { status: 409, statusText: 'Conflict' });

    facade.reloadTaskAfterConflict('task-1');
    const reload = httpMock.expectOne('/api/tasks/task-1');
    facade.reloadTaskAfterConflict('task-1');
    httpMock.expectNone('/api/tasks/task-1');
    reload.flush({ message: 'temporary' }, { status: 500, statusText: 'Server Error' });
    expect(facade.getTaskMutationState().status).toBe('conflict');

    facade.reloadTaskAfterConflict('task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: { ...editableTaskDto, title: 'Authoritative' }, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    expect(facade.getTaskMutationState().status).toBe('idle');
    expect(facade.getTaskDetail('project-1', 'task-1').editorTask?.title).toBe('Authoritative');
  });

  it('reauthorizes and removes protected detail when task save is forbidden', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    facade.saveTask('task-1', 'project-1', { title: 'Edited', description: '', priority: 'medium', startDate: '', dueDate: '', progressPercent: 1, expectedVersion: '1' });
    httpMock.expectOne('/api/tasks/task-1').flush({}, { status: 403, statusText: 'Forbidden' });

    expect(facade.getTaskDetail('project-1', 'task-1').detail).toBeUndefined();
    httpMock.expectOne('/api/projects').flush({ items: [] });
    expect(facade.getTaskDetail('project-1', 'task-1').status).toBe('empty');
  });

  it('reauthorizes when a successful detail mutation cannot reload protected detail', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    facade.setWatch('task-1', true, '1');
    httpMock.expectOne('/api/tasks/task-1/watch').flush({});
    httpMock.expectOne('/api/tasks/task-1').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(facade.getTaskDetail('project-1', 'task-1').detail).toBeUndefined();
    httpMock.expectOne('/api/projects').flush({ items: [] });
  });

  it('clears a comment conflict after aggregate reload, while a page retry stays a page request', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [{ id: 'comment-1', bodyPlainText: 'first' }] }, files: { items: [] } });
    facade.updateComment('task-1', 'comment-1', 'changed', false, '1');
    httpMock.expectOne('/api/task-comments/comment-1').flush({ code: 'TASK_STALE_VERSION' }, { status: 409, statusText: 'Conflict' });
    expect(facade.getDetailSectionState('comments').status).toBe('conflict');
    facade.retrySection('task-1', 'comments');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [{ id: 'comment-1', bodyPlainText: 'latest' }] }, files: { items: [] } });
    expect(facade.getDetailSectionState('comments').status).toBe('ready');
  });

  it('does not let a label-definition GET overwrite a submitting label mutation', () => {
    flushInitialLoad([]);
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, permissions: { canApplyLabels: true }, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    const definitions = httpMock.expectOne('/api/projects/project-1/task-labels?includeArchived=true');
    facade.applyLabel('task-1', 'label-1');
    const mutation = httpMock.expectOne('/api/tasks/task-1/labels/label-1');
    definitions.flush([{ id: 'label-1', name: 'Label', sortKey: 1, isArchived: false, version: 1 }]);
    expect(facade.getDetailSectionState('labels').status).toBe('submitting');
    mutation.flush({});
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, permissions: { canApplyLabels: true }, checklist: [], labels: [{ id: 'label-1', name: 'Label' }], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    expect(facade.getDetailSectionState('labels').status).toBe('ready');
  });

  it('keeps a comment conflict and the editor state when an unrelated watch mutation succeeds', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    const aggregate = { task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [{ id: 'comment-1', bodyPlainText: 'first' }] }, files: { items: [] } };
    httpMock.expectOne('/api/tasks/task-1').flush(aggregate);
    facade.updateComment('task-1', 'comment-1', 'changed', false, '1');
    httpMock.expectOne('/api/task-comments/comment-1').flush({ error: { code: 'TASK_STALE_VERSION' } }, { status: 409, statusText: 'Conflict' });

    facade.setWatch('task-1', true, '1');
    expect(facade.getTaskMutationState().status).toBe('idle');
    httpMock.expectOne('/api/tasks/task-1/watch').flush({});
    httpMock.expectOne('/api/tasks/task-1').flush(aggregate);

    expect(facade.getDetailSectionState('comments').status).toBe('conflict');
    expect(facade.getTaskMutationState().status).toBe('idle');
  });

  it('keeps previously loaded comment pages when a Watch mutation returns an aggregate first page', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [{ id: 'comment-1', bodyPlainText: 'one' }], page: 1, pageSize: 20, totalCount: 2, hasMore: true }, files: { items: [] } });
    facade.loadMoreComments('task-1');
    httpMock.expectOne('/api/tasks/task-1/comments?page=2&pageSize=20').flush({ items: [{ id: 'comment-2', bodyPlainText: 'two' }], page: 2, pageSize: 20, totalCount: 2, hasMore: false });
    facade.setWatch('task-1', true, '1');
    httpMock.expectOne('/api/tasks/task-1/watch').flush({});
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [{ id: 'comment-1', bodyPlainText: 'one updated' }], page: 1, pageSize: 20, totalCount: 2, hasMore: true }, files: { items: [] } });
    expect(facade.getTaskDetail('project-1', 'task-1').detail?.comments.items.map(item => item.id)).toEqual(['comment-1', 'comment-2']);
  });

  it('does not create a Task-body conflict while a subresource mutation is submitting', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
    facade.setWatch('task-1', true, '1');
    (facade as unknown as { handleRealtimeEvent(event: unknown): void }).handleRealtimeEvent({ eventId: 'self-task-change', eventType: 'Projects.TaskChanged.v1', aggregateId: 'task-1' });
    expect(facade.getTaskMutationState().status).toBe('idle');
    httpMock.expectOne('/api/tasks/task-1/watch').flush({});
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [] }, files: { items: [] } });
  });

  it('rejects an invalid expected version without issuing a PATCH', () => {
    flushInitialLoad();
    facade.saveTask('task-1', 'project-1', { title: 'Edited', description: '', priority: 'medium', startDate: '', dueDate: '', progressPercent: 1, expectedVersion: 'invalid' });
    httpMock.expectNone('/api/tasks/task-1');
    expect(facade.getTaskMutationState().status).toBe('validation');
  });

  it('clears checklist, file, and label conflicts only after their authoritative aggregate reloads', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    const aggregate = { task: editableTaskDto, checklist: [{ id: 'check-1', text: 'one', isCompleted: false, version: 1 }], labels: [{ id: 'label-1', name: 'Label' }], subtasks: { items: [] }, comments: { items: [] }, files: { items: [{ id: 'file-1', fileName: 'one.txt' }] } };
    httpMock.expectOne('/api/tasks/task-1').flush(aggregate);

    facade.updateChecklist('task-1', 'check-1', 'next', false, '1');
    httpMock.expectOne('/api/tasks/task-1/checklist/check-1').flush({ code: 'TASK_STALE_VERSION' }, { status: 409, statusText: 'Conflict' });
    facade.retrySection('task-1', 'checklist');
    httpMock.expectOne('/api/tasks/task-1').flush(aggregate);
    expect(facade.getDetailSectionState('checklist').status).toBe('ready');

    facade.associateFile('task-1', 'file-2', '1');
    httpMock.expectOne('/api/tasks/task-1/files').flush({ code: 'TASK_STALE_VERSION' }, { status: 409, statusText: 'Conflict' });
    facade.retrySection('task-1', 'files');
    httpMock.expectOne('/api/tasks/task-1').flush(aggregate);
    expect(facade.getDetailSectionState('files').status).toBe('ready');

    facade.applyLabel('task-1', 'label-1');
    httpMock.expectOne('/api/tasks/task-1/labels/label-1').flush({ code: 'TASK_STALE_VERSION' }, { status: 409, statusText: 'Conflict' });
    facade.retrySection('task-1', 'labels');
    httpMock.expectOne('/api/tasks/task-1').flush(aggregate);
    expect(facade.getDetailSectionState('labels').status).toBe('ready');
  });

  it('does not send label create or update requests beyond backend-trimmed limits', () => {
    flushInitialLoad();
    facade.createProjectLabel('task-1', 'project-1', 'n'.repeat(121));
    facade.updateProjectLabel('task-1', 'project-1', 'label-1', 'n'.repeat(121), '', '1', '1');
    facade.updateProjectLabel('task-1', 'project-1', 'label-1', 'valid', 'd'.repeat(1001), '1', '1');
    httpMock.expectNone(request => request.url.includes('/task-labels'));
  });

  it('retries the same failed comments page without duplicating existing comments', () => {
    flushInitialLoad();
    facade.ensureTaskDetail('project-1', 'task-1');
    httpMock.expectOne('/api/tasks/task-1').flush({ task: editableTaskDto, checklist: [], labels: [], subtasks: { items: [] }, comments: { items: [{ id: 'comment-1', bodyPlainText: 'first' }], page: 1, pageSize: 20, totalCount: 2, hasMore: true }, files: { items: [] } });

    facade.loadMoreComments('task-1');
    httpMock.expectOne('/api/tasks/task-1/comments?page=2&pageSize=20').flush({ message: 'temporary', traceId: 'comments-2' }, { status: 500, statusText: 'Server Error' });
    expect(facade.getDetailSectionState('comments')).toMatchObject({ status: 'error', retryKind: 'page', failedPage: 2 });

    facade.retrySection('task-1', 'comments');
    httpMock.expectOne('/api/tasks/task-1/comments?page=2&pageSize=20').flush({ items: [{ id: 'comment-1', bodyPlainText: 'first' }, { id: 'comment-2', bodyPlainText: 'second' }], page: 2, pageSize: 20, totalCount: 2, hasMore: false });
    expect(facade.getTaskDetail('project-1', 'task-1').detail?.comments.items.map(item => item.id)).toEqual(['comment-1', 'comment-2']);
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

  function realtimeEvent(eventType: 'Security.AuthorizationStateChanged.v1') {
    return { eventId: 'event-1', eventType, payloadSchemaVersion: 1, occurredAt: '2026-07-24T00:00:00Z', tenantId: 'tenant-1', aggregateType: 'Security', aggregateId: 'security-1', aggregateVersion: null, actor: { actorType: 'System', actorId: null }, correlationId: null, causationId: null, payload: {} };
  }
});
