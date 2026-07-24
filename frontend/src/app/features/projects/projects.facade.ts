import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
import { catchError, finalize, map, switchMap } from 'rxjs/operators';

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
  /** Changes when a permission boundary changes. Never accept a prior authorization response. */
  private authorizationGeneration = 0;
  private detailGeneration = 0;
  private projectsRequest: Subscription | null = null;
  private detailRequest: Subscription | null = null;
  private readonly pageRequests = new Map<TaskDetailSection, Subscription>();
  private labelRequest: Subscription | null = null;
  private readonly detailMutations = new Set<Subscription>();
  private readonly taskDetails = signal<Record<string, CanonicalTaskDetailDto>>({});
  private readonly projectLabelDefinitions = signal<Record<string, readonly TaskLabelDto[]>>({});
  private readonly labelDefinitionStates = signal<Record<string, TaskDetailSectionState>>({});
  private activeTaskId: string | null = null;
  private activeProjectId: string | null = null;
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
    const aggregateState = this.getDetailSectionState('detail');
    if (scenario.status === 'permissionDenied') {
      return {
        status: 'permissionDenied',
        detailState: 'ready',
        detailSectionState: aggregateState,
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
      return { status: 'empty', detailState: 'ready', detailSectionState: aggregateState, dependencies: [], capabilities: [], transitionNote: TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE, message: 'TASK_DETAIL_PROJECT_MISMATCH' };
    }
    return {
      status: task ? 'ready' : scenario.status === 'ready' ? 'empty' : scenario.status,
      detailState: scenario.detailState ?? 'ready',
      detailSectionState: aggregateState,
      project: project ? this.toProjectSummary(project) : undefined,
      task: task ? this.toTaskRow(task) : undefined,
      editorTask: task,
      dependencies: task ? this.toDependencies(task) : [],
      capabilities: task?.capabilities ?? [],
      transitionNote: TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
      detail: detail && task ? this.mapDetail(detail) : undefined,
      message: aggregateState.message ?? scenario.message
    };
  }

  ensureTaskDetail(projectId?: string, taskId?: string): void {
    if (!projectId || !taskId) {
      return;
    }

    if (this.activeTaskId !== taskId || this.activeProjectId !== projectId) this.clearProtectedTaskState();
    this.activeTaskId = taskId;
    this.activeProjectId = projectId;
    this.activeProjectSubscription?.();
    this.activeProjectSubscription = this.realtime.registerSubscription('projects-active-task', { subscriptionType: 'project', resourceId: projectId });
    if (!this.taskDetails()[taskId]) {
      this.loadTaskDetail(taskId);
    }
  }

  releaseTaskDetail(): void {
    this.clearProtectedTaskState();
    this.activeTaskId = null;
    this.activeProjectId = null;
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

  loadProjectLabelDefinitions(projectId: string, force = false, onReady?: () => void): void {
    const taskId = this.activeTaskId;
    if (this.scenario || !projectId || !taskId || !this.isActive(taskId, this.detailGeneration)) return;
    if (!force && this.projectLabelDefinitions()[projectId] && this.labelDefinitionStates()[projectId]?.status === 'ready') { onReady?.(); return; }
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
          onReady?.();
        },
        error: error => {
          if (!this.isActive(taskId, generation)) return;
          const failure = toSectionFailure(error, 'Label definitions could not be loaded.');
          this.setLabelDefinitionState(projectId, failure);
        }
      });
  }

  createProjectLabel(taskId: string, projectId: string, name: string, onSuccess?: () => void): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.runDetailCommand(taskId, 'labels', this.http.post(`/api/projects/${projectId}/task-labels`, { name: trimmed, description: null }, { withCredentials: true }), () => this.loadProjectLabelDefinitions(projectId, true, onSuccess));
  }

  updateProjectLabel(taskId: string, projectId: string, labelId: string, name: string, description: string, sortKey: string, expectedVersion: string, onSuccess?: () => void): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.runDetailCommand(taskId, 'labels', this.http.patch(`/api/projects/${projectId}/task-labels/${labelId}`, { name: trimmed, description: description.trim() || null, sortKey: Number(sortKey), expectedVersion: Number(expectedVersion) }, { withCredentials: true }), () => this.loadProjectLabelDefinitions(projectId, true, onSuccess));
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
    const failed = this.getDetailSectionState(section);
    if (section === 'detail' || failed.retryKind === 'aggregate') this.loadTaskDetail(taskId);
    else if (section === 'labels') {
      const projectId = this.taskDetails()[taskId]?.task?.projectId;
      if (typeof projectId === 'string') this.loadProjectLabelDefinitions(projectId, true);
    } else if (section === 'subtasks' || section === 'comments' || section === 'files') this.loadNextPage(taskId, section, failed.failedPage);
    else this.loadTaskDetail(taskId);
  }

  createSubtask(taskId: string, title: string, onSuccess?: () => void): void { const trimmed = title.trim(); if (trimmed && trimmed.length <= 300) this.runDetailCommand(taskId, 'subtasks', this.http.post(`/api/tasks/${taskId}/subtasks`, { title: trimmed, description: null, priority: 1 }, { withCredentials: true }), onSuccess); }
  createChecklist(taskId: string, text: string, onSuccess?: () => void): void { const trimmed = text.trim(); if (trimmed && trimmed.length <= 1000) this.runDetailCommand(taskId, 'checklist', this.http.post(`/api/tasks/${taskId}/checklist`, { text: trimmed }, { withCredentials: true }), onSuccess); }
  updateChecklist(taskId: string, itemId: string, text: string, isCompleted: boolean, expectedVersion: string, onSuccess?: () => void): void { const trimmed = text.trim(); if (trimmed && trimmed.length <= 1000) this.runDetailCommand(taskId, 'checklist', this.http.patch(`/api/tasks/${taskId}/checklist/${itemId}`, { text: trimmed, isCompleted, expectedVersion: Number(expectedVersion) }, { withCredentials: true }), onSuccess); }
  deleteChecklist(taskId: string, itemId: string, expectedVersion: string): void { this.runDetailCommand(taskId, 'checklist', this.http.delete(`/api/tasks/${taskId}/checklist/${itemId}?expectedVersion=${encodeURIComponent(expectedVersion)}`, { withCredentials: true })); }
  reorderChecklist(taskId: string, orderedItemIds: readonly string[], expectedTaskVersion: string): void { this.runDetailCommand(taskId, 'checklist', this.http.put(`/api/tasks/${taskId}/checklist/order`, { orderedItemIds, expectedTaskVersion: Number(expectedTaskVersion) }, { withCredentials: true })); }
  createComment(taskId: string, bodyPlainText: string, isImportant: boolean, onSuccess?: () => void): void { const body = bodyPlainText.trim(); if (body && body.length <= 12000) this.runDetailCommand(taskId, 'comments', this.http.post(`/api/tasks/${taskId}/comments`, { bodyPlainText: body, isImportant }, { withCredentials: true }), onSuccess); }
  updateComment(taskId: string, commentId: string, bodyPlainText: string, isImportant: boolean, expectedVersion: string, onSuccess?: () => void): void { const body = bodyPlainText.trim(); if (body && body.length <= 12000) this.runDetailCommand(taskId, 'comments', this.http.patch(`/api/task-comments/${commentId}`, { bodyPlainText: body, isImportant, expectedVersion: Number(expectedVersion) }, { withCredentials: true }), onSuccess); }
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

    const authorizationGeneration = this.authorizationGeneration;
    const detailGeneration = this.detailGeneration;
    const isCurrent = () => this.isAuthorizationCurrent(authorizationGeneration) &&
      (this.activeTaskId === null || this.isActive(taskId, detailGeneration));
    this.taskMutationState.set({ status: 'submitting' });
    const operation = this.http
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
          if (!isCurrent()) return;
          this.replaceProjectTasks(projectId, projectTasks);
          this.taskDetails.update((details) => ({ ...details, [taskId]: task.detail }));
          this.replaceTask(task.task);
          this.myTasksFacade.refreshIfLoaded();
          this.taskMutationState.set({ status: 'success' });
        },
        error: (error: unknown) => {
          if (!isCurrent()) return;
          this.taskMutationState.set(toFailureState(error, 'Task save failed.'));
        }
      });
    this.trackDetailMutation(operation);
  }

  createTask(request: CreateTaskFormRequest): void {
    if (this.scenario || this.taskCreateMutationState().status === 'submitting') {
      return;
    }

    const authorizationGeneration = this.authorizationGeneration;
    this.taskCreateMutationState.set({ status: 'submitting' });
    const operation = this.http
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
          if (!this.isAuthorizationCurrent(authorizationGeneration)) return;
          this.replaceProjectTasks(request.projectId, projectTasks);
          this.myTasksFacade.refreshIfLoaded();
          this.taskCreateMutationState.set({ status: 'success' });
        },
        error: (error: unknown) => {
          if (!this.isAuthorizationCurrent(authorizationGeneration)) return;
          this.taskCreateMutationState.set(toFailureState(error, 'Task create failed.'));
        }
      });
    this.trackDetailMutation(operation);
  }

  getStatusLabel(status: TaskGridRow['status']): string {
    return taskStatusLabel(status);
  }

  private loadProjects(afterAuthorized?: () => void): void {
    const generation = this.authorizationGeneration;
    this.projectsRequest?.unsubscribe();
    this.liveState.set(this.emptyScenario('loading'));
    this.projectsRequest = this.fetchProjectList()
      .pipe(
        switchMap((projects) => {
          if (projects.length === 0) {
            return of({
              projects,
              tasks: []
            } satisfies ProjectsLoadResult);
          }

          return forkJoin({
            taskPages: forkJoin(projects.map((project) => this.fetchProjectTasks(project.id, projects)))
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
          if (!this.isAuthorizationCurrent(generation)) return;
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
          afterAuthorized?.();
        },
        error: (error: unknown) => {
          if (!this.isAuthorizationCurrent(generation)) return;
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
      this.reauthorizeActiveState();
      return;
    }

    // The current realtime catalog only emits the aggregate invalidations below;
    // subresource change names remain a future server contract rather than guesses.
    if (!['Projects.TaskChanged.v1', 'Projects.ProjectChanged.v1', 'Files.FileChanged.v1'].includes(event.eventType)) {
      return;
    }

    if (event.eventType === 'Projects.TaskChanged.v1' && this.activeTaskId === event.aggregateId) {
      if (this.isDetailEditing()) {
        this.setSectionState('detail', { status: 'conflict', message: 'This task changed elsewhere. Your editor was preserved; reload before saving again.', requestId: event.eventId });
      } else {
        this.loadTaskDetail(event.aggregateId);
      }
      return;
    }

    if (event.eventType === 'Files.FileChanged.v1' && this.activeTaskId) {
      this.loadTaskDetail(this.activeTaskId);
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

  private fetchProjectTasks(projectId: string, projects = this.authorizedProjects()): Observable<readonly TaskMockRecord[]> {
    return this.http
      .get<PagedResponseDto<TaskDto>>(`/api/projects/${projectId}/tasks`, {
        withCredentials: true
      })
      .pipe(
        map((response) =>
          (response.items ?? []).map((task) => mapTaskDtoToRecord(task, projects))
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
    const authorizationGeneration = this.authorizationGeneration;
    const generation = this.detailGeneration;
    this.setSectionState('detail', { status: 'loading' });
    this.detailRequest = this.fetchTask(taskId).pipe(finalize(() => {
      if (this.isActive(taskId, generation)) this.detailRequest = null;
    })).subscribe({
      next: (response) => {
        if (!this.isAuthorizationCurrent(authorizationGeneration) || !this.isActive(taskId, generation)) return;
        this.taskDetails.update((details) => ({ ...details, [taskId]: response.detail }));
        this.replaceTask(response.task);
        this.setSectionState('detail', { status: 'ready' });
        const projectId = response.detail.task?.projectId;
        const permissions = response.detail.permissions;
        if (typeof projectId === 'string' && (permissions?.canApplyLabels === true || permissions?.canManageLabelDefinitions === true)) this.loadProjectLabelDefinitions(projectId);
      },
      error: (error: unknown) => {
        if (!this.isAuthorizationCurrent(authorizationGeneration) || !this.isActive(taskId, generation)) return;
        this.taskDetails.set({});
        this.setSectionState('detail', toSectionFailure(error, 'Task detail could not be loaded.'));
      }
    });
  }

  /** Components may report unsaved local edits so realtime never silently overwrites them. */
  private detailEditing = false;
  setDetailEditing(editing: boolean): void { this.detailEditing = editing; }
  private isDetailEditing(): boolean { return this.detailEditing || this.taskMutationState().status === 'submitting'; }

  private reauthorizeActiveState(): void {
    const activeTaskId = this.activeTaskId;
    const activeProjectId = this.activeProjectId;
    this.authorizationGeneration++;
    // Drop protected state before issuing the first reauthorization request.
    this.clearProtectedTaskState();
    this.liveState.set(this.emptyScenario('loading'));
    this.loadProjects(() => {
      if (!activeTaskId || !activeProjectId || this.activeTaskId !== activeTaskId || this.activeProjectId !== activeProjectId) return;
      const visible = this.liveState().tasks.some(task => task.id === activeTaskId && task.projectId === activeProjectId && task.authorized);
      if (!visible) {
        this.setSectionState('detail', { status: 'permissionDenied', message: 'Task detail is no longer available with your current permission.' });
        return;
      }
      this.loadTaskDetail(activeTaskId);
    });
  }

  private runDetailCommand(taskId: string, section: TaskDetailSection, request: Observable<unknown>, onSuccess?: () => void): void {
    if (this.scenario || !this.isActive(taskId, this.detailGeneration) || this.sectionStates()[section].status === 'submitting') return;
    const authorizationGeneration = this.authorizationGeneration;
    const generation = this.detailGeneration;
    this.setSectionState(section, { status: 'submitting' });
    this.taskMutationState.set({ status: 'submitting' });
    const operation = request.pipe(
      switchMap(() => this.fetchTask(taskId).pipe(
        map(response => ({ response })),
        catchError(reloadError => of({ reloadError }))
      ))
    ).subscribe({
      next: result => {
        if (!this.isAuthorizationCurrent(authorizationGeneration) || !this.isActive(taskId, generation)) return;
        if ('reloadError' in result) {
          const reloadFailure = toSectionFailure(result.reloadError, 'Saved successfully, but the latest task detail could not be loaded.');
          this.setSectionState(section, { ...reloadFailure, status: reloadFailure.status === 'permissionDenied' ? 'permissionDenied' : 'error', message: `Saved successfully, but the latest task detail could not be loaded. ${reloadFailure.message ?? ''}`.trim(), retryKind: 'aggregate' });
          this.taskMutationState.set({ status: 'success' });
          return;
        }
        this.taskDetails.update((details) => ({ ...details, [taskId]: result.response.detail }));
        this.replaceTask(result.response.task);
        this.setSectionState(section, { status: 'success' });
        this.taskMutationState.set({ status: 'success' });
        onSuccess?.();
      },
      error: (error: unknown) => {
        if (!this.isAuthorizationCurrent(authorizationGeneration) || !this.isActive(taskId, generation)) return;
        const normalized = normalizeApiError(error);
        if (normalized.httpStatus === 401 || normalized.httpStatus === 403) {
          this.reauthorizeActiveState();
          return;
        }
        const state = toFailureState(error, 'Task detail command failed.');
        this.taskMutationState.set(state);
        this.setSectionState(section, toSectionFailure(error, state.status === 'failure' || state.status === 'conflict' ? state.message : 'Task detail command failed.'));
      }
    });
    this.trackDetailMutation(operation);
  }

  private loadNextPage(taskId: string, section: 'subtasks' | 'comments' | 'files', retryPage?: number): void {
    const detail = this.taskDetails()[taskId];
    if (!detail || !this.isActive(taskId, this.detailGeneration)) return;
    const current = detail[section];
    const currentPage = typeof current?.page === 'number' ? current.page : 1;
    const pageSize = typeof current?.pageSize === 'number' && current.pageSize > 0 ? current.pageSize : section === 'subtasks' ? 50 : 20;
    if (!retryPage && current?.hasMore !== true) return;
    if (this.pageRequests.has(section)) return;
    const generation = this.detailGeneration;
    const authorizationGeneration = this.authorizationGeneration;
    const page = retryPage ?? currentPage + 1;
    const endpoint = `/api/tasks/${taskId}/${section}?page=${page}&pageSize=${pageSize}`;
    this.setSectionState(section, { status: 'loading' });
    const request = this.http.get<PagedResponseDto<unknown>>(endpoint, { withCredentials: true }).pipe(finalize(() => {
      if (this.isActive(taskId, generation)) this.pageRequests.delete(section);
    })).subscribe({
      next: response => {
        if (!this.isAuthorizationCurrent(authorizationGeneration) || !this.isActive(taskId, generation)) return;
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
        if (!this.isAuthorizationCurrent(authorizationGeneration) || !this.isActive(taskId, generation)) return;
        const failure = { ...toSectionFailure(error, `More ${section} could not be loaded.`), retryKind: 'page' as const, failedPage: page };
        if (failure.status === 'permissionDenied') { this.reauthorizeActiveState(); return; }
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
    this.detailMutations.forEach(request => request.unsubscribe());
    this.detailMutations.clear();
    this.taskDetails.set({});
    this.projectLabelDefinitions.set({});
    this.labelDefinitionStates.set({});
    this.sectionStates.set(this.emptySectionStates());
    this.taskMutationState.set({ status: 'idle' });
    this.taskCreateMutationState.set({ status: 'idle' });
    this.detailEditing = false;
  }

  private isActive(taskId: string, generation: number): boolean {
    return this.activeTaskId === taskId && this.detailGeneration === generation;
  }

  private isAuthorizationCurrent(generation: number): boolean { return this.authorizationGeneration === generation; }

  private trackDetailMutation(request: Subscription): void {
    this.detailMutations.add(request);
    request.add(() => this.detailMutations.delete(request));
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
      workspaceId: nullableText(detail.task?.workspaceId),
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
  const normalized = normalizeApiError(error);
  const stale = normalized.code === 'TASK_STALE_VERSION' || normalized.details.some(detail => detail.code === 'TASK_STALE_VERSION');
  if (normalized.httpStatus === 409 || stale) return { status: 'conflict', message: normalized.message || fallback, requestId: normalized.requestId };
  if (normalized.httpStatus === 400 || normalized.httpStatus === 422) return { status: 'validation', message: normalized.message || fallback, requestId: normalized.requestId };
  if (normalized.httpStatus === 429) return { status: 'rateLimited', message: normalized.message || fallback, requestId: normalized.requestId };
  return { status: 'failure', message: normalized.message || fallback, requestId: normalized.requestId };
}

function toSectionFailure(error: unknown, fallback: string): TaskDetailSectionState {
  const normalized = normalizeApiError(error);
  if (normalized.httpStatus === 401 || normalized.httpStatus === 403) return { status: 'permissionDenied', message: 'Permission was denied. Protected task data was removed.', retryable: true, retryKind: 'authorization', requestId: normalized.requestId };
  if (normalized.httpStatus === 409 || normalized.code === 'TASK_STALE_VERSION') return { status: 'conflict', message: normalized.message || fallback, retryable: true, retryKind: 'aggregate', requestId: normalized.requestId };
  return { status: 'error', message: normalized.message || fallback, retryable: true, requestId: normalized.requestId };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
