import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
import { finalize, map, switchMap } from 'rxjs/operators';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { FrontendApiError } from '../../core/api/api-error.model';
import { MyTasksFacade } from './my-tasks.facade';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { CanonicalTaskDetailDto, PagedResponseDto, ProjectDto, TaskDto, TaskLabelDto, toCreateTaskRequestDto, toUpdateTaskRequestDto } from './projects.api';
import {
  mapProjectDtoToRecord,
  mapTaskDtoToRecord,
  taskStatusLabel
} from './projects.mapper';
import {
  CreateTaskFormRequest,
  PROJECTS_DEFAULT_PAGE_SIZE,
  PROJECTS_MAXIMUM_PAGE_SIZE,
  ProjectMockRecord,
  ProjectSummaryViewModel,
  ProjectsOverviewViewModel,
  ProjectsPageStatus,
  ProjectsScenario,
  MyTasksViewModel,
  TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
  TaskDetailAggregateViewModel,
  TaskDetailViewModel,
  TaskEditorSaveRequest,
  TaskGridRow,
  TaskDetailSection,
  TaskDetailSectionState,
  TaskMockRecord,
  TaskMutationState,
  TaskRowAction
} from './projects.types';

export const AIP_PROJECTS_MOCK = new InjectionToken<ProjectsScenario>('AIP_PROJECTS_MOCK');

interface ProjectsLoadResult {
  readonly projects: readonly ProjectMockRecord[];
  readonly tasks: readonly TaskMockRecord[];
}

interface ErrorBody {
  readonly message?: unknown;
  readonly error?: unknown;
  readonly traceId?: unknown;
  readonly requestId?: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class ProjectsFacade {
  private readonly http = inject(HttpClient);
  private readonly myTasksFacade = inject(MyTasksFacade);
  private readonly realtime = inject(RealtimeFacade);
  private readonly scenario = inject(AIP_PROJECTS_MOCK, { optional: true });
  private readonly liveState = signal<ProjectsScenario>(
    this.scenario ?? this.emptyScenario('loading')
  );
  private readonly taskMutationState = signal<TaskMutationState>({ status: 'idle' });
  private readonly taskCreateMutationState = signal<TaskMutationState>({ status: 'idle' });
  private readonly sectionStates = signal<Record<TaskDetailSection, TaskDetailSectionState>>(this.emptySectionStates());
  /** A single generation invalidates every protected response on navigation or authorization change. */
  private detailGeneration = 0;
  private detailRequest: Subscription | null = null;
  private readonly pageRequests = new Map<TaskDetailSection, Subscription>();
  private labelRequest: Subscription | null = null;
  private readonly taskDetails = signal<Record<string, CanonicalTaskDetailDto>>({});
  private readonly projectLabelDefinitions = signal<Record<string, readonly TaskLabelDto[]>>({});
  private readonly labelDefinitionStates = signal<Record<string, TaskDetailSectionState>>({});
  private activeTaskId: string | null = null;
  private activeProjectSubscription: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.realtime.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event));
    if (!this.scenario) {
      this.loadProjects();
    }
  }

  getProjectsOverview(): ProjectsOverviewViewModel {
    const scenario = this.liveState();
    if (scenario.status === 'permissionDenied') {
      return this.emptyOverview(scenario, 'permissionDenied', scenario.message);
    }

    const projects = this.authorizedProjects().map((project) => this.toProjectSummary(project));
    const rows = this.authorizedTasks().map((task) => this.toTaskRow(task));

    return {
      status: scenario.status,
      title: scenario.title,
      subtitle: scenario.subtitle,
      projects,
      rows,
      columns: [],
      pageSize: this.pageSize,
      message: scenario.message,
      error: scenario.error
    };
  }

  getMyTasks(): MyTasksViewModel {
    const scenario = this.liveState();
    if (scenario.status === 'permissionDenied') {
      return {
        status: 'permissionDenied',
        title: 'My tasks',
        subtitle: 'Tasks assigned to the signed-in user',
        rows: [],
        columns: [],
        pageSize: this.pageSize,
        message: scenario.message,
        tasks: [], selectedTab: 'assigned', scope: 'currentWorkspace', workspaceId: null, counts: [], totalCount: 0, realtimeDegraded: false
      };
    }

    const myTasksStatus = scenario.myTasksStatus ?? scenario.status;
    return {
      status: myTasksStatus,
      title: 'My tasks',
      subtitle: 'Tasks assigned to the signed-in user',
      rows: myTasksStatus === 'ready' ? this.authorizedMyTasks().map((task) => this.toTaskRow(task)) : [],
        columns: [],
        pageSize: this.pageSize,
        message: scenario.myTasksMessage ?? scenario.message,
        tasks: [], selectedTab: 'assigned', scope: 'currentWorkspace', workspaceId: null, counts: [], totalCount: 0, realtimeDegraded: false
    };
  }

  getTaskDetail(projectId?: string, taskId?: string): TaskDetailViewModel {
    const scenario = this.liveState();
    if (scenario.status === 'permissionDenied') {
      return {
        status: 'permissionDenied',
        detailState: 'ready',
        dependencies: [],
        capabilities: [],
        transitionNote: TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
        message: scenario.message
      };
    }

    const task = scenario.tasks.find(
      (candidate) => candidate.authorized && candidate.projectId === projectId && candidate.id === taskId
    );
    const project = task
      ? this.authorizedProjects().find((candidate) => candidate.id === task.projectId)
      : undefined;

    const detail = taskId ? this.taskDetails()[taskId] : undefined;
    const loadedProjectId = typeof detail?.task?.projectId === 'string' ? detail.task.projectId : undefined;
    if (detail && loadedProjectId && loadedProjectId !== projectId) {
      return { status: 'empty', detailState: 'ready', dependencies: [], capabilities: [], transitionNote: TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE, message: 'TASK_DETAIL_PROJECT_MISMATCH' };
    }
    return {
      status: task ? 'ready' : scenario.status === 'ready' ? 'empty' : scenario.status,
      detailState: scenario.detailState ?? 'ready',
      project: project ? this.toProjectSummary(project) : undefined,
      task: task ? this.toTaskRow(task) : undefined,
      editorTask: task,
      dependencies: task ? this.toDependencies(task) : [],
      capabilities: task?.capabilities ?? [],
      transitionNote: TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
      detail: detail && task ? this.mapDetail(detail) : undefined,
      message: scenario.message
    };
  }

  ensureTaskDetail(projectId?: string, taskId?: string): void {
    if (!projectId || !taskId) {
      return;
    }

    if (this.activeTaskId !== taskId) this.clearProtectedTaskState();
    this.activeTaskId = taskId;
    this.activeProjectSubscription?.();
    this.activeProjectSubscription = this.realtime.registerSubscription('projects-active-task', { subscriptionType: 'project', resourceId: projectId });
    if (!this.taskDetails()[taskId]) {
      this.loadTaskDetail(taskId);
    }
  }

  releaseTaskDetail(): void {
    this.clearProtectedTaskState();
    this.activeTaskId = null;
    this.activeProjectSubscription?.();
    this.activeProjectSubscription = null;
  }

  getTaskMutationState(): TaskMutationState {
    return this.taskMutationState();
  }

  getTaskCreateMutationState(): TaskMutationState {
    return this.taskCreateMutationState();
  }

  clearTaskMutationState(): void {
    this.taskMutationState.set({ status: 'idle' });
  }

  clearTaskCreateMutationState(): void {
    this.taskCreateMutationState.set({ status: 'idle' });
  }

  getDetailSectionState(section: TaskDetailSection): TaskDetailSectionState {
    return this.sectionStates()[section];
  }

  loadProjectLabelDefinitions(projectId: string, force = false): void {
    const taskId = this.activeTaskId;
    if (this.scenario || !projectId || !taskId || !this.isActive(taskId, this.detailGeneration)) return;
    if (!force && this.projectLabelDefinitions()[projectId]) return;
    this.labelRequest?.unsubscribe();
    const generation = this.detailGeneration;
    this.setLabelDefinitionState(projectId, { status: 'loading' });
    this.labelRequest = this.http.get<readonly TaskLabelDto[]>(`/api/projects/${projectId}/task-labels?includeArchived=true`, { withCredentials: true })
      .pipe(finalize(() => { if (this.isActive(taskId, generation)) this.labelRequest = null; }))
      .subscribe({
        next: labels => {
          if (!this.isActive(taskId, generation)) return;
          this.projectLabelDefinitions.update(current => ({ ...current, [projectId]: labels }));
          this.setLabelDefinitionState(projectId, { status: labels.length ? 'ready' : 'empty' });
        },
        error: error => {
          if (!this.isActive(taskId, generation)) return;
          const failure = toSectionFailure(error, 'Label definitions could not be loaded.');
          this.projectLabelDefinitions.update(current => ({ ...current, [projectId]: [] }));
          this.setLabelDefinitionState(projectId, failure);
        }
      });
  }

  createProjectLabel(taskId: string, projectId: string, name: string, onSuccess?: () => void): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.runDetailCommand(taskId, 'labels', this.http.post(`/api/projects/${projectId}/task-labels`, { name: trimmed, description: null }, { withCredentials: true }), () => { this.loadProjectLabelDefinitions(projectId, true); onSuccess?.(); });
  }

  updateProjectLabel(taskId: string, projectId: string, labelId: string, name: string, description: string, sortKey: string, expectedVersion: string, onSuccess?: () => void): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.runDetailCommand(taskId, 'labels', this.http.patch(`/api/projects/${projectId}/task-labels/${labelId}`, { name: trimmed, description: description.trim() || null, sortKey: Number(sortKey), expectedVersion: Number(expectedVersion) }, { withCredentials: true }), () => { this.loadProjectLabelDefinitions(projectId, true); onSuccess?.(); });
  }

  setProjectLabelArchived(taskId: string, projectId: string, labelId: string, expectedVersion: string, archived: boolean): void {
    const action = archived ? 'archive' : 'restore';
    this.runDetailCommand(taskId, 'labels', this.http.post(`/api/projects/${projectId}/task-labels/${labelId}/${action}?expectedVersion=${encodeURIComponent(expectedVersion)}`, {}, { withCredentials: true }), () => this.loadProjectLabelDefinitions(projectId, true));
  }

  retryTaskDetail(taskId: string): void { this.loadTaskDetail(taskId); }

  loadMoreSubtasks(taskId: string): void { this.loadNextPage(taskId, 'subtasks'); }
  loadMoreComments(taskId: string): void { this.loadNextPage(taskId, 'comments'); }
  loadMoreFiles(taskId: string): void { this.loadNextPage(taskId, 'files'); }
  retrySection(taskId: string, section: TaskDetailSection): void {
    if (section === 'detail') this.loadTaskDetail(taskId);
    else if (section === 'labels') {
      const projectId = this.taskDetails()[taskId]?.task?.projectId;
      if (typeof projectId === 'string') this.loadProjectLabelDefinitions(projectId, true);
    } else if (section === 'subtasks' || section === 'comments' || section === 'files') this.loadNextPage(taskId, section, true);
  }

  createSubtask(taskId: string, title: string, onSuccess?: () => void): void { const trimmed = title.trim(); if (trimmed) this.runDetailCommand(taskId, 'subtasks', this.http.post(`/api/tasks/${taskId}/subtasks`, { title: trimmed, description: null, priority: 1 }, { withCredentials: true }), onSuccess); }
  createChecklist(taskId: string, text: string, onSuccess?: () => void): void { this.runDetailCommand(taskId, 'checklist', this.http.post(`/api/tasks/${taskId}/checklist`, { text }, { withCredentials: true }), onSuccess); }
  updateChecklist(taskId: string, itemId: string, text: string, isCompleted: boolean, expectedVersion: string, onSuccess?: () => void): void { this.runDetailCommand(taskId, 'checklist', this.http.patch(`/api/tasks/${taskId}/checklist/${itemId}`, { text, isCompleted, expectedVersion: Number(expectedVersion) }, { withCredentials: true }), onSuccess); }
  deleteChecklist(taskId: string, itemId: string, expectedVersion: string): void { this.runDetailCommand(taskId, 'checklist', this.http.delete(`/api/tasks/${taskId}/checklist/${itemId}?expectedVersion=${encodeURIComponent(expectedVersion)}`, { withCredentials: true })); }
  reorderChecklist(taskId: string, orderedItemIds: readonly string[], expectedTaskVersion: string): void { this.runDetailCommand(taskId, 'checklist', this.http.put(`/api/tasks/${taskId}/checklist/order`, { orderedItemIds, expectedTaskVersion: Number(expectedTaskVersion) }, { withCredentials: true })); }
  createComment(taskId: string, bodyPlainText: string, isImportant: boolean, onSuccess?: () => void): void { this.runDetailCommand(taskId, 'comments', this.http.post(`/api/tasks/${taskId}/comments`, { bodyPlainText, isImportant }, { withCredentials: true }), onSuccess); }
  updateComment(taskId: string, commentId: string, bodyPlainText: string, isImportant: boolean, expectedVersion: string, onSuccess?: () => void): void { this.runDetailCommand(taskId, 'comments', this.http.patch(`/api/task-comments/${commentId}`, { bodyPlainText, isImportant, expectedVersion: Number(expectedVersion) }, { withCredentials: true }), onSuccess); }
  deleteComment(taskId: string, commentId: string, expectedVersion: string): void { this.runDetailCommand(taskId, 'comments', this.http.delete(`/api/task-comments/${commentId}?expectedVersion=${encodeURIComponent(expectedVersion)}`, { withCredentials: true })); }
  applyLabel(taskId: string, labelId: string, onSuccess?: () => void): void { this.runDetailCommand(taskId, 'labels', this.http.put(`/api/tasks/${taskId}/labels/${labelId}`, {}, { withCredentials: true }), onSuccess); }
  removeLabel(taskId: string, labelId: string): void { this.runDetailCommand(taskId, 'labels', this.http.delete(`/api/tasks/${taskId}/labels/${labelId}`, { withCredentials: true })); }
  setWatch(taskId: string, watching: boolean, expectedVersion: string): void { this.runDetailCommand(taskId, 'watch', watching ? this.http.put(`/api/tasks/${taskId}/watch`, { expectedVersion: Number(expectedVersion) }, { withCredentials: true }) : this.http.delete(`/api/tasks/${taskId}/watch?expectedVersion=${encodeURIComponent(expectedVersion)}`, { withCredentials: true })); }
  associateFile(taskId: string, attachmentId: string, expectedVersion: string, onSuccess?: () => void): void { this.runDetailCommand(taskId, 'files', this.http.post(`/api/tasks/${taskId}/files`, { attachmentId, expectedVersion: Number(expectedVersion) }, { withCredentials: true }), onSuccess); }
  removeFile(taskId: string, associationId: string, expectedVersion: string): void { this.runDetailCommand(taskId, 'files', this.http.delete(`/api/tasks/${taskId}/files/${associationId}?expectedVersion=${encodeURIComponent(expectedVersion)}`, { withCredentials: true })); }

  retryProjects(): void {
    if (this.scenario) {
      return;
    }

    this.loadProjects();
  }

  saveTask(taskId: string, projectId: string, request: TaskEditorSaveRequest): void {
    if (this.scenario || this.taskMutationState().status === 'submitting') {
      return;
    }

    this.taskMutationState.set({ status: 'submitting' });
    this.http
      .patch<TaskDto>(`/api/tasks/${taskId}`, toUpdateTaskRequestDto(request), {
        withCredentials: true
      })
      .pipe(
        switchMap(() =>
          forkJoin({
            task: this.fetchTask(taskId),
            projectTasks: this.fetchProjectTasks(projectId)
          })
        )
      )
      .subscribe({
        next: ({ task, projectTasks }) => {
          this.replaceProjectTasks(projectId, projectTasks);
          this.taskDetails.update((details) => ({ ...details, [taskId]: task.detail }));
          this.replaceTask(task.task);
          this.myTasksFacade.refreshIfLoaded();
          this.taskMutationState.set({ status: 'success' });
        },
        error: (error: unknown) => {
          this.taskMutationState.set(toFailureState(error, 'Task save failed.'));
        }
      });
  }

  createTask(request: CreateTaskFormRequest): void {
    if (this.scenario || this.taskCreateMutationState().status === 'submitting') {
      return;
    }

    this.taskCreateMutationState.set({ status: 'submitting' });
    this.http
      .post<TaskDto>(`/api/projects/${request.projectId}/tasks`, toCreateTaskRequestDto(request), {
        withCredentials: true
      })
      .pipe(
        switchMap(() =>
          forkJoin({
            projectTasks: this.fetchProjectTasks(request.projectId)
          })
        )
      )
      .subscribe({
        next: ({ projectTasks }) => {
          this.replaceProjectTasks(request.projectId, projectTasks);
          this.myTasksFacade.refreshIfLoaded();
          this.taskCreateMutationState.set({ status: 'success' });
        },
        error: (error: unknown) => {
          this.taskCreateMutationState.set(toFailureState(error, 'Task create failed.'));
        }
      });
  }

  getStatusLabel(status: TaskGridRow['status']): string {
    return taskStatusLabel(status);
  }

  private loadProjects(): void {
    this.liveState.set(this.emptyScenario('loading'));
    this.fetchProjectList()
      .pipe(
        switchMap((projects) => {
          if (projects.length === 0) {
            return of({
              projects,
              tasks: []
            } satisfies ProjectsLoadResult);
          }

          return forkJoin({
            taskPages: forkJoin(projects.map((project) => this.fetchProjectTasks(project.id)))
          }).pipe(
            map(({ taskPages }) => ({
              projects,
              tasks: taskPages.flat()
            }))
          );
        })
      )
      .subscribe({
        next: (result) => {
          if (result.projects.length === 0) {
            this.liveState.set(
              this.emptyScenario('empty', 'No authorized projects were returned by the API.')
            );
            return;
          }

          this.liveState.set({
            status: 'ready',
            title: 'Projects',
            subtitle: 'Live API data',
            projects: result.projects,
            tasks: result.tasks,
            myTasks: [],
            currentUserAssignee: ''
          });
        },
        error: (error: unknown) => {
          const normalized = normalizeApiError(error);
          this.liveState.set(
            this.emptyScenario(
              normalized.httpStatus === 401 || normalized.httpStatus === 403 ? 'permissionDenied' : 'error',
              normalized.httpStatus === 401 || normalized.httpStatus === 403
                ? 'Authentication or project permission is required.'
                : 'Projects could not be loaded. Try again.',
              normalized
            )
          );
        }
      });
  }

  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    if (this.scenario) {
      return;
    }

    if (event.eventType === 'Security.AuthorizationStateChanged.v1') {
      // Drop first, then any future HTTP request must prove current authorization.
      this.clearProtectedTaskState();
      this.liveState.set(this.emptyScenario('loading'));
      this.loadProjects();
      this.myTasksFacade.refreshIfLoaded();
      return;
    }

    // The current realtime catalog only emits the aggregate invalidations below;
    // subresource change names remain a future server contract rather than guesses.
    if (!['Projects.TaskChanged.v1', 'Projects.ProjectChanged.v1', 'Files.FileChanged.v1'].includes(event.eventType)) {
      return;
    }

    if (event.eventType === 'Projects.TaskChanged.v1' && this.activeTaskId === event.aggregateId) {
      this.setSectionState('detail', { status: 'conflict', message: 'This task changed elsewhere. Your editor was preserved; reload before saving again.', requestId: event.eventId });
      return;
    }

    this.queueRealtimeRefresh();
  }

  private queueRealtimeRefresh(): void {
    if (this.refreshTimer !== null) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.loadProjects();
      this.myTasksFacade.refreshIfLoaded();
    }, 100);
  }

  private fetchProjectList(): Observable<readonly ProjectMockRecord[]> {
    return this.http
      .get<PagedResponseDto<ProjectDto>>('/api/projects', { withCredentials: true })
      .pipe(map((response) => (response.items ?? []).map((project) => mapProjectDtoToRecord(project))));
  }

  private fetchProjectTasks(projectId: string): Observable<readonly TaskMockRecord[]> {
    return this.http
      .get<PagedResponseDto<TaskDto>>(`/api/projects/${projectId}/tasks`, {
        withCredentials: true
      })
      .pipe(
        map((response) =>
          (response.items ?? []).map((task) => mapTaskDtoToRecord(task, this.authorizedProjects()))
        )
      );
  }

  private fetchTask(taskId: string): Observable<{ readonly task: TaskMockRecord; readonly detail: CanonicalTaskDetailDto }> {
    return this.http
      .get<CanonicalTaskDetailDto>(`/api/tasks/${taskId}`, { withCredentials: true })
      .pipe(map((detail) => ({ task: mapTaskDtoToRecord((detail.task ?? detail) as TaskDto, this.authorizedProjects()), detail })));
  }

  private loadTaskDetail(taskId: string): void {
    if (this.scenario) {
      return;
    }

    if (this.activeTaskId !== taskId) return;
    this.detailRequest?.unsubscribe();
    const generation = this.detailGeneration;
    this.setSectionState('detail', { status: 'loading' });
    this.detailRequest = this.fetchTask(taskId).pipe(finalize(() => {
      if (this.isActive(taskId, generation)) this.detailRequest = null;
    })).subscribe({
      next: (response) => {
        if (!this.isActive(taskId, generation)) return;
        this.taskDetails.update((details) => ({ ...details, [taskId]: response.detail }));
        this.replaceTask(response.task);
        this.setSectionState('detail', { status: 'ready' });
        const projectId = response.detail.task?.projectId;
        const permissions = response.detail.permissions;
        if (typeof projectId === 'string' && (permissions?.canApplyLabels === true || permissions?.canManageLabelDefinitions === true)) this.loadProjectLabelDefinitions(projectId);
      },
      error: (error: unknown) => {
        if (!this.isActive(taskId, generation)) return;
        this.taskDetails.set({});
        this.setSectionState('detail', toSectionFailure(error, 'Task detail could not be loaded.'));
      }
    });
  }

  private runDetailCommand(taskId: string, section: TaskDetailSection, request: Observable<unknown>, onSuccess?: () => void): void {
    if (this.scenario || !this.isActive(taskId, this.detailGeneration) || this.sectionStates()[section].status === 'submitting') return;
    const generation = this.detailGeneration;
    this.setSectionState(section, { status: 'submitting' });
    this.taskMutationState.set({ status: 'submitting' });
    request.pipe(switchMap(() => this.fetchTask(taskId))).subscribe({
      next: (response) => {
        if (!this.isActive(taskId, generation)) return;
        this.taskDetails.update((details) => ({ ...details, [taskId]: response.detail }));
        this.replaceTask(response.task);
        this.setSectionState(section, { status: 'success' });
        this.taskMutationState.set({ status: 'success' });
        const projectId = response.detail.task?.projectId;
        if (section === 'labels' && typeof projectId === 'string') this.loadProjectLabelDefinitions(projectId, true);
        onSuccess?.();
      },
      error: (error: unknown) => {
        if (!this.isActive(taskId, generation)) return;
        const state = toFailureState(error, 'Task detail command failed.');
        this.taskMutationState.set(state);
        this.setSectionState(section, toSectionFailure(error, state.status === 'failure' || state.status === 'conflict' ? state.message : 'Task detail command failed.'));
      }
    });
  }

  private loadNextPage(taskId: string, section: 'subtasks' | 'comments' | 'files', retry = false): void {
    const detail = this.taskDetails()[taskId];
    if (!detail || !this.isActive(taskId, this.detailGeneration)) return;
    const current = detail[section];
    const currentPage = typeof current?.page === 'number' ? current.page : 1;
    const pageSize = typeof current?.pageSize === 'number' && current.pageSize > 0 ? current.pageSize : section === 'subtasks' ? 50 : 20;
    if (!retry && current?.hasMore !== true) return;
    if (this.pageRequests.has(section)) return;
    const generation = this.detailGeneration;
    const page = retry ? currentPage + 1 : currentPage + 1;
    const endpoint = `/api/tasks/${taskId}/${section}?page=${page}&pageSize=${pageSize}`;
    this.setSectionState(section, { status: 'loading' });
    const request = this.http.get<PagedResponseDto<unknown>>(endpoint, { withCredentials: true }).pipe(finalize(() => {
      if (this.isActive(taskId, generation)) this.pageRequests.delete(section);
    })).subscribe({
      next: response => {
        if (!this.isActive(taskId, generation)) return;
        const existing = current?.items ?? [];
        const incoming = (response.items ?? []) as typeof existing;
        const seen = new Set(existing.map(item => typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : ''));
        const items = [...existing, ...incoming.filter(item => {
          const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : '';
          return !id || !seen.has(id) && (seen.add(id), true);
        })];
        this.taskDetails.update(details => ({ ...details, [taskId]: { ...details[taskId], [section]: { items, page: response.page ?? page, pageSize: response.pageSize ?? pageSize, totalCount: response.totalCount ?? items.length, hasMore: response.hasMore === true } } }));
        this.setSectionState(section, { status: items.length ? 'ready' : 'empty' });
      },
      error: error => {
        if (!this.isActive(taskId, generation)) return;
        const failure = toSectionFailure(error, `More ${section} could not be loaded.`);
        if (failure.status === 'permissionDenied') this.taskDetails.update(details => ({ ...details, [taskId]: { ...details[taskId], [section]: { items: [], page: 1, pageSize, totalCount: 0, hasMore: false } } }));
        this.setSectionState(section, failure);
      }
    });
    this.pageRequests.set(section, request);
  }

  private clearProtectedTaskState(): void {
    this.detailGeneration++;
    this.detailRequest?.unsubscribe();
    this.detailRequest = null;
    this.labelRequest?.unsubscribe();
    this.labelRequest = null;
    this.pageRequests.forEach(request => request.unsubscribe());
    this.pageRequests.clear();
    this.taskDetails.set({});
    this.projectLabelDefinitions.set({});
    this.labelDefinitionStates.set({});
    this.sectionStates.set(this.emptySectionStates());
    this.taskMutationState.set({ status: 'idle' });
  }

  private isActive(taskId: string, generation: number): boolean {
    return this.activeTaskId === taskId && this.detailGeneration === generation;
  }

  private setSectionState(section: TaskDetailSection, state: TaskDetailSectionState): void {
    this.sectionStates.update(current => ({ ...current, [section]: state }));
  }

  private setLabelDefinitionState(projectId: string, state: TaskDetailSectionState): void {
    this.labelDefinitionStates.update(current => ({ ...current, [projectId]: state }));
    this.setSectionState('labels', state);
  }

  private emptySectionStates(): Record<TaskDetailSection, TaskDetailSectionState> {
    return { detail: { status: 'idle' }, subtasks: { status: 'idle' }, checklist: { status: 'idle' }, comments: { status: 'idle' }, labels: { status: 'idle' }, watch: { status: 'idle' }, files: { status: 'idle' } };
  }

  private mapDetail(detail: CanonicalTaskDetailDto): TaskDetailAggregateViewModel {
    const boolean = (value: unknown) => value === true;
    const text = (value: unknown) => typeof value === 'string' ? value : '';
    const nullableText = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : null;
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const version = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '0';
    const page = <TSource, TView>(source: PagedResponseDto<TSource> | null | undefined, items: readonly TView[]) => ({ items, page: number(source?.page) || 1, pageSize: number(source?.pageSize) || items.length, totalCount: number(source?.totalCount), hasMore: boolean(source?.hasMore) });
    return {
      permissions: {
        canCreateSubtask: boolean(detail.permissions?.canCreateSubtask), canCreateChecklistItem: boolean(detail.permissions?.canCreateChecklistItem),
        canUpdateChecklistItems: boolean(detail.permissions?.canUpdateChecklistItems), canDeleteChecklistItems: boolean(detail.permissions?.canDeleteChecklistItems),
        canReorderChecklist: boolean(detail.permissions?.canReorderChecklist), canCreateComment: boolean(detail.permissions?.canCreateComment),
        canMarkCommentImportant: boolean(detail.permissions?.canMarkCommentImportant), canApplyLabels: boolean(detail.permissions?.canApplyLabels),
        canManageLabelDefinitions: boolean(detail.permissions?.canManageLabelDefinitions), canAssociateFiles: boolean(detail.permissions?.canAssociateFiles),
        canRemoveFiles: boolean(detail.permissions?.canRemoveFiles), canChangeWatch: boolean(detail.permissions?.canChangeWatch)
      },
      taskVersion: version(detail.task?.version),
      checklist: (detail.checklist ?? []).map((item) => ({ id: text(item.id), text: text(item.text), isCompleted: boolean(item.isCompleted), completedAt: nullableText(item.completedAt), completedByUserId: nullableText(item.completedByUserId), sortKey: version(item.sortKey), version: version(item.version) })),
      labels: (detail.labels ?? []).map((item) => ({ id: text(item.id), name: text(item.name), description: nullableText(item.description), sortKey: version(item.sortKey), isArchived: boolean(item.isArchived), version: version(item.version) })),
      labelDefinitions: (this.projectLabelDefinitions()[text(detail.task?.projectId)] ?? []).map((item) => ({ id: text(item.id), name: text(item.name), description: nullableText(item.description), sortKey: version(item.sortKey), isArchived: boolean(item.isArchived), version: version(item.version) })),
      labelDefinitionsState: this.labelDefinitionStates()[text(detail.task?.projectId)] ?? { status: 'idle' },
      subtasks: page(detail.subtasks, (detail.subtasks?.items ?? []).map((item) => ({ id: text(item.id), parentTaskId: text(item.parentTaskId), title: text(item.title), workflowStageId: nullableText(item.workflowStageId), stage: text(item.workflowStageName), stageCategory: text(item.stageCategory), priority: text(item.priority), progressPercent: number(item.progressPercent), primaryAssignee: nullableText(item.primaryAssignee?.displayName), plannedEndDate: nullableText(item.plannedEndDate), deadlineAt: nullableText(item.deadlineAt), isOverdue: boolean(item.isOverdue), version: version(item.version) }))),
      comments: page(detail.comments, (detail.comments?.items ?? []).map((item) => ({ id: text(item.id), taskId: text(item.taskId), author: nullableText(item.author?.displayName), body: nullableText(item.bodyPlainText), isImportant: boolean(item.isImportant), mentions: (item.mentions ?? []).map(mention => ({ userId: text(mention.userId), displayName: text(mention.displayName) })).filter(mention => mention.userId && mention.displayName), createdAt: nullableText(item.createdAt), updatedAt: nullableText(item.updatedAt), deletedAt: nullableText(item.deletedAt), version: version(item.version), canEdit: boolean(item.canEdit), canDelete: boolean(item.canDelete), canMarkImportant: boolean(item.canMarkImportant) }))),
      files: page(detail.files, (detail.files?.items ?? []).map((item) => ({ id: text(item.id), fileObjectId: text(item.fileObjectId), fileName: text(item.fileName), contentType: text(item.contentType), sizeBytes: number(item.sizeBytes), scanStatus: text(item.scanStatus), createdAt: nullableText(item.createdAt), accessState: text(item.accessState), canOpen: boolean(item.canOpen), canRequestDownloadGrant: boolean(item.canRequestDownloadGrant), downloadGrantRequired: boolean(item.downloadGrantRequired), restrictionCode: nullableText(item.restrictionCode) }))),
      watchState: { isWatching: boolean(detail.watchState?.isWatching), isExplicitOptOut: boolean(detail.watchState?.isExplicitOptOut), automaticSources: (detail.watchState?.automaticSources ?? []).filter((source): source is string => typeof source === 'string'), version: version(detail.watchState?.version) }
    };
  }

  private emptyScenario(status: ProjectsPageStatus, message?: string, error?: FrontendApiError): ProjectsScenario {
    return {
      status,
      title: 'Projects',
      subtitle: 'Live API data',
      projects: [],
      tasks: [],
      myTasks: [],
      currentUserAssignee: '',
      message,
      ...(error ? { error } : {})
    };
  }

  private emptyOverview(
    scenario: ProjectsScenario,
    status: ProjectsOverviewViewModel['status'],
    message?: string
  ): ProjectsOverviewViewModel {
    return {
      status,
      title: scenario.title,
      subtitle: scenario.subtitle,
      projects: [],
      rows: [],
      columns: [],
      pageSize: this.pageSize,
      message,
      error: scenario.error
    };
  }

  private get pageSize(): ProjectsOverviewViewModel['pageSize'] {
    return {
      defaultPageSize: PROJECTS_DEFAULT_PAGE_SIZE,
      maximumPageSize: PROJECTS_MAXIMUM_PAGE_SIZE
    };
  }

  private authorizedProjects(): readonly ProjectMockRecord[] {
    return this.liveState().projects.filter((project) => project.authorized);
  }

  private authorizedTasks(): readonly TaskMockRecord[] {
    const authorizedProjectIds = new Set(this.authorizedProjects().map((project) => project.id));
    return this.liveState().tasks.filter(
      (task) => task.authorized && authorizedProjectIds.has(task.projectId)
    );
  }

  private authorizedMyTasks(): readonly TaskMockRecord[] {
    const scenario = this.liveState();
    const myTasks =
      scenario.myTasks ??
      scenario.tasks.filter(
        (task) =>
          scenario.currentUserAssignee.length === 0 ||
          task.assignee === scenario.currentUserAssignee
      );
    const authorizedProjectIds = new Set(this.authorizedProjects().map((project) => project.id));
    return myTasks.filter((task) => task.authorized && authorizedProjectIds.has(task.projectId));
  }

  private toProjectSummary(project: ProjectMockRecord): ProjectSummaryViewModel {
    const tasks = this.authorizedTasks().filter((task) => task.projectId === project.id);

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      statusLabel: project.statusLabel,
      startDate: project.startDate,
      dueDate: project.dueDate,
      group: project.group,
      taskCounts: {
        total: tasks.length,
        done: tasks.filter((task) => task.status === 'done').length,
        blocked: tasks.filter((task) => task.status === 'blocked').length
      },
      canCreateTask: project.canCreateTask
    };
  }

  private toTaskRow(task: TaskMockRecord): TaskGridRow {
    const projectName =
      this.authorizedProjects().find((project) => project.id === task.projectId)?.name ??
      'Project';

    return {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      project: projectName,
      status: task.status,
      statusLabel: task.statusLabel,
      priority: task.priority,
      priorityLabel: task.priorityLabel,
      assignee: task.assignee,
      startDate: task.startDate,
      dueDate: task.dueDate,
      progressPercent: task.progressPercent,
      milestone: task.milestone,
      allowedTransitions: task.allowedTransitions,
      rowActions: this.buildActions(task)
    };
  }

  private buildActions(task: TaskMockRecord): readonly TaskRowAction[] {
    const actions: TaskRowAction[] = [
      {
        id: 'openDetail',
        label: 'Open',
        disabled: false
      }
    ];

    if (task.capabilities.includes('editTask')) {
      actions.push({
        id: 'edit',
        label: 'Edit',
        disabled: false
      });
    }

    if (task.capabilities.includes('assignTask')) {
      actions.push({
        id: 'assign',
        label: 'Assign',
        disabled: true,
        disabledReason: 'Assignment controls are not implemented in the Angular MVP0 workflow.',
        mobileHidden: this.liveState().mobile
      });
    }

    if (task.capabilities.includes('changeTaskStatus')) {
      actions.push({
        id: 'changeStatus',
        label: 'Status',
        disabled: task.allowedTransitions.length === 0,
        disabledReason:
          task.allowedTransitions.length === 0
            ? 'No backend-provided transition is currently allowed.'
            : undefined,
        mobileHidden: this.liveState().mobile
      });
    }

    return actions.filter((action) => !action.mobileHidden);
  }

  private toDependencies(task: TaskMockRecord) {
    return task.dependencyIds
      .map((dependencyId) =>
        this.authorizedTasks().find((candidate) => candidate.id === dependencyId)
      )
      .filter((dependency): dependency is TaskMockRecord => dependency !== undefined)
      .map((dependency) => ({
        id: dependency.id,
        title: dependency.title,
        status: dependency.status
      }));
  }

  private replaceProjectTasks(projectId: string, projectTasks: readonly TaskMockRecord[]): void {
    this.liveState.update((state) => ({
      ...state,
      tasks: [
        ...state.tasks.filter((task) => task.projectId !== projectId),
        ...projectTasks
      ]
    }));
  }

  private replaceTask(task: TaskMockRecord): void {
    this.liveState.update((state) => {
      const exists = state.tasks.some((candidate) => candidate.id === task.id);
      return {
        ...state,
        tasks: exists
          ? state.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
          : [...state.tasks, task]
      };
    });
  }

}

function toFailureState(error: unknown, fallback: string): TaskMutationState {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as ErrorBody | undefined;
    const message =
      stringValue(body?.message) ?? stringValue(body?.error) ?? error.message ?? fallback;
    const requestId = stringValue(body?.traceId) ?? stringValue(body?.requestId);
    return { status: 'failure', message, requestId };
  }

  return { status: 'failure', message: fallback };
}

function toSectionFailure(error: unknown, fallback: string): TaskDetailSectionState {
  const normalized = normalizeApiError(error);
  if (normalized.httpStatus === 401 || normalized.httpStatus === 403) return { status: 'permissionDenied', message: 'Permission was denied. Protected task data was removed.', retryable: true, requestId: normalized.requestId };
  if (normalized.httpStatus === 409) return { status: 'conflict', message: normalized.message || fallback, retryable: true, requestId: normalized.requestId };
  return { status: 'error', message: normalized.message || fallback, retryable: true, requestId: normalized.requestId };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
