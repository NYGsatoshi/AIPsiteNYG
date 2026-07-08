import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  MyTaskDto,
  PagedResponseDto,
  ProjectDto,
  TaskDto,
  toCreateTaskRequestDto,
  toUpdateTaskRequestDto
} from './projects.api';
import {
  mapMyTaskDtoToRecord,
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
  TaskDetailViewModel,
  TaskEditorSaveRequest,
  TaskGridRow,
  TaskMockRecord,
  TaskMutationState,
  TaskRowAction
} from './projects.types';

export const AIP_PROJECTS_MOCK = new InjectionToken<ProjectsScenario>('AIP_PROJECTS_MOCK');

interface ProjectsLoadResult {
  readonly projects: readonly ProjectMockRecord[];
  readonly tasks: readonly TaskMockRecord[];
  readonly myTasks: readonly TaskMockRecord[];
  readonly myTasksStatus: ProjectsPageStatus;
  readonly myTasksMessage?: string;
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
  private readonly scenario = inject(AIP_PROJECTS_MOCK, { optional: true });
  private readonly liveState = signal<ProjectsScenario>(
    this.scenario ?? this.emptyScenario('loading')
  );
  private readonly taskMutationState = signal<TaskMutationState>({ status: 'idle' });
  private readonly taskCreateMutationState = signal<TaskMutationState>({ status: 'idle' });
  private readonly taskDetailRequests = new Set<string>();

  constructor() {
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
      message: scenario.message
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
        message: scenario.message
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
      message: scenario.myTasksMessage ?? scenario.message
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

    const task = this.authorizedTasks().find(
      (candidate) => candidate.projectId === projectId && candidate.id === taskId
    );
    if (!task && scenario.status !== 'loading' && projectId && taskId) {
      this.loadTaskDetail(taskId);
    }
    const project = task
      ? this.authorizedProjects().find((candidate) => candidate.id === task.projectId)
      : undefined;

    return {
      status:
        task && project ? scenario.status : scenario.status === 'loading' ? 'loading' : 'empty',
      detailState: scenario.detailState ?? 'ready',
      project: project ? this.toProjectSummary(project) : undefined,
      task: task ? this.toTaskRow(task) : undefined,
      editorTask: task,
      dependencies: task ? this.toDependencies(task) : [],
      capabilities: task?.capabilities ?? [],
      transitionNote: TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
      message: scenario.message
    };
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
            projectTasks: this.fetchProjectTasks(projectId),
            myTasks: this.fetchMyTasks()
          })
        )
      )
      .subscribe({
        next: ({ task, projectTasks, myTasks }) => {
          this.replaceProjectTasks(projectId, projectTasks);
          this.replaceTask(task);
          this.replaceMyTasks(myTasks.items, myTasks.status, myTasks.message);
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
            projectTasks: this.fetchProjectTasks(request.projectId),
            myTasks: this.fetchMyTasks()
          })
        )
      )
      .subscribe({
        next: ({ projectTasks, myTasks }) => {
          this.replaceProjectTasks(request.projectId, projectTasks);
          this.replaceMyTasks(myTasks.items, myTasks.status, myTasks.message);
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
    this.fetchProjectList()
      .pipe(
        switchMap((projects) => {
          if (projects.length === 0) {
            return of({
              projects,
              tasks: [],
              myTasks: [],
              myTasksStatus: 'empty' as const,
              myTasksMessage: 'No assigned tasks were returned by the API.'
            } satisfies ProjectsLoadResult);
          }

          return forkJoin({
            taskPages: forkJoin(
              projects.map((project) => this.fetchProjectTasks(project.id).pipe(catchError(() => of([]))))
            ),
            myTasks: this.fetchMyTasks()
          }).pipe(
            map(({ taskPages, myTasks }) => ({
              projects,
              tasks: taskPages.flat(),
              myTasks: myTasks.items,
              myTasksStatus: myTasks.status,
              myTasksMessage: myTasks.message
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
            myTasks: result.myTasks,
            myTasksStatus: result.myTasksStatus,
            myTasksMessage: result.myTasksMessage,
            currentUserAssignee: ''
          });
        },
        error: (error: { status?: number }) => {
          this.liveState.set(
            this.emptyScenario(
              error.status === 401 || error.status === 403 ? 'permissionDenied' : 'error',
              error.status === 401 || error.status === 403
                ? 'Authentication or project permission is required.'
                : 'Project API request failed.'
            )
          );
        }
      });
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

  private fetchTask(taskId: string): Observable<TaskMockRecord> {
    return this.http
      .get<TaskDto>(`/api/tasks/${taskId}`, { withCredentials: true })
      .pipe(map((task) => mapTaskDtoToRecord(task, this.authorizedProjects())));
  }

  private loadTaskDetail(taskId: string): void {
    if (this.scenario || this.taskDetailRequests.has(taskId)) {
      return;
    }

    this.taskDetailRequests.add(taskId);
    this.fetchTask(taskId).subscribe({
      next: (task) => {
        this.taskDetailRequests.delete(taskId);
        this.replaceTask(task);
      },
      error: () => {
        this.taskDetailRequests.delete(taskId);
      }
    });
  }

  private fetchMyTasks(): Observable<{
    readonly items: readonly TaskMockRecord[];
    readonly status: ProjectsPageStatus;
    readonly message?: string;
  }> {
    return this.http
      .get<PagedResponseDto<MyTaskDto>>('/api/me/tasks', { withCredentials: true })
      .pipe(
        map((response) => ({
          items: (response.items ?? []).map((task) => mapMyTaskDtoToRecord(task)),
          status: 'ready' as const
        })),
        catchError((error: { status?: number }) =>
          of({
            items: [],
            status: error.status === 401 || error.status === 403 ? 'permissionDenied' : 'error',
            message:
              error.status === 401 || error.status === 403
                ? 'Authentication or task assignment permission is required.'
                : 'My Tasks API request failed.'
          } satisfies {
            readonly items: readonly TaskMockRecord[];
            readonly status: ProjectsPageStatus;
            readonly message?: string;
          })
        )
      );
  }

  private emptyScenario(status: ProjectsPageStatus, message?: string): ProjectsScenario {
    return {
      status,
      title: 'Projects',
      subtitle: 'Live API data',
      projects: [],
      tasks: [],
      myTasks: [],
      currentUserAssignee: '',
      message
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
      message
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

  private replaceMyTasks(
    myTasks: readonly TaskMockRecord[],
    status: ProjectsPageStatus,
    message?: string
  ): void {
    this.liveState.update((state) => ({
      ...state,
      myTasks,
      myTasksStatus: status,
      myTasksMessage: message
    }));
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
