import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  PROJECTS_DEFAULT_PAGE_SIZE,
  PROJECTS_MAXIMUM_PAGE_SIZE,
  ProjectStatus,
  ProjectMockRecord,
  ProjectSummaryViewModel,
  ProjectsOverviewViewModel,
  ProjectsPageStatus,
  ProjectsScenario,
  TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
  TaskDetailViewModel,
  TaskGridRow,
  TaskMockRecord,
  TaskPriority,
  TaskStatus,
  TaskRowAction,
  MyTasksViewModel,
} from './projects.types';

export const AIP_PROJECTS_MOCK = new InjectionToken<ProjectsScenario>('AIP_PROJECTS_MOCK');

interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

interface ProjectDto {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly startDate?: unknown;
  readonly endDate?: unknown;
}

interface TaskDto {
  readonly id?: unknown;
  readonly projectId?: unknown;
  readonly milestoneId?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly status?: unknown;
  readonly priority?: unknown;
  readonly startDate?: unknown;
  readonly dueDate?: unknown;
  readonly progressPercent?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class ProjectsFacade {
  private readonly http = inject(HttpClient);
  private readonly scenario = inject(AIP_PROJECTS_MOCK, { optional: true });
  private readonly liveState = signal<ProjectsScenario>(
    this.scenario ?? this.emptyScenario('loading'),
  );

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
      message: scenario.message,
    };
  }

  getMyTasks(): MyTasksViewModel {
    const scenario = this.liveState();
    if (scenario.status === 'permissionDenied') {
      return {
        status: 'permissionDenied',
        title: 'My tasks',
        subtitle: 'Live API data',
        rows: [],
        columns: [],
        pageSize: this.pageSize,
        message: scenario.message,
      };
    }

    return {
      status: scenario.status,
      title: 'My tasks',
      subtitle: 'Live API data',
      rows: this.authorizedTasks().map((task) => this.toTaskRow(task)),
      columns: [],
      pageSize: this.pageSize,
      message: scenario.message,
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
        message: scenario.message,
      };
    }

    const task =
      this.authorizedTasks().find(
        (candidate) => candidate.projectId === projectId && candidate.id === taskId,
      ) ?? this.authorizedTasks()[0];
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
      message: scenario.message,
    };
  }

  getStatusLabel(status: TaskGridRow['status']): string {
    return (
      {
        notStarted: 'Not started',
        inProgress: 'In progress',
        blocked: 'Blocked',
        review: 'Review',
        done: 'Done',
      } satisfies Record<TaskGridRow['status'], string>
    )[status];
  }

  private loadProjects(): void {
    this.http
      .get<PagedResponseDto<ProjectDto>>('/api/projects', { withCredentials: true })
      .subscribe({
        next: (response) => {
          const projects = (response.items ?? []).map((project) => this.toProjectRecord(project));
          if (projects.length === 0) {
            this.liveState.set(
              this.emptyScenario('empty', 'No authorized projects were returned by the API.'),
            );
            return;
          }

          forkJoin(
            projects.map((project) =>
              this.http
                .get<
                  PagedResponseDto<TaskDto>
                >(`/api/projects/${project.id}/tasks`, { withCredentials: true })
                .pipe(catchError(() => of({ items: [] } satisfies PagedResponseDto<TaskDto>))),
            ),
          ).subscribe({
            next: (taskPages) => {
              const tasks = taskPages.flatMap((page) =>
                (page.items ?? []).map((task) => this.toTaskRecord(task, projects)),
              );
              this.liveState.set({
                status: 'ready',
                title: 'Projects',
                subtitle: 'Live API data',
                projects,
                tasks,
                currentUserAssignee: '',
              });
            },
            error: () => {
              this.liveState.set(this.emptyScenario('error', 'Project task API request failed.'));
            },
          });
        },
        error: (error: { status?: number }) => {
          this.liveState.set(
            this.emptyScenario(
              error.status === 401 || error.status === 403 ? 'permissionDenied' : 'error',
              error.status === 401 || error.status === 403
                ? 'Authentication or project permission is required.'
                : 'Project API request failed.',
            ),
          );
        },
      });
  }

  private emptyScenario(status: ProjectsPageStatus, message?: string): ProjectsScenario {
    return {
      status,
      title: 'Projects',
      subtitle: 'Live API data',
      projects: [],
      tasks: [],
      currentUserAssignee: '',
      message,
    };
  }

  private emptyOverview(
    scenario: ProjectsScenario,
    status: ProjectsOverviewViewModel['status'],
    message?: string,
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
    };
  }

  private get pageSize(): ProjectsOverviewViewModel['pageSize'] {
    return {
      defaultPageSize: PROJECTS_DEFAULT_PAGE_SIZE,
      maximumPageSize: PROJECTS_MAXIMUM_PAGE_SIZE,
    };
  }

  private authorizedProjects(): readonly ProjectMockRecord[] {
    return this.liveState().projects.filter((project) => project.authorized);
  }

  private authorizedTasks(): readonly TaskMockRecord[] {
    const authorizedProjectIds = new Set(this.authorizedProjects().map((project) => project.id));
    return this.liveState().tasks.filter(
      (task) => task.authorized && authorizedProjectIds.has(task.projectId),
    );
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
        blocked: tasks.filter((task) => task.status === 'blocked').length,
      },
    };
  }

  private toTaskRow(task: TaskMockRecord): TaskGridRow {
    const projectName =
      this.authorizedProjects().find((project) => project.id === task.projectId)?.name ?? 'Project';

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
      rowActions: this.buildActions(task),
    };
  }

  private buildActions(task: TaskMockRecord): readonly TaskRowAction[] {
    const actions: TaskRowAction[] = [
      {
        id: 'openDetail',
        label: 'Open',
        disabled: false,
      },
    ];

    if (task.capabilities.includes('editTask')) {
      actions.push({
        id: 'edit',
        label: 'Edit',
        disabled: false,
      });
    }

    if (task.capabilities.includes('assignTask')) {
      actions.push({
        id: 'assign',
        label: 'Assign',
        disabled: false,
        mobileHidden: this.liveState().mobile,
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
        mobileHidden: this.liveState().mobile,
      });
    }

    return actions.filter((action) => !action.mobileHidden);
  }

  private toDependencies(task: TaskMockRecord) {
    return task.dependencyIds
      .map((dependencyId) =>
        this.authorizedTasks().find((candidate) => candidate.id === dependencyId),
      )
      .filter((dependency): dependency is TaskMockRecord => dependency !== undefined)
      .map((dependency) => ({
        id: dependency.id,
        title: dependency.title,
        status: dependency.status,
      }));
  }

  private toProjectRecord(project: ProjectDto): ProjectMockRecord {
    const status = projectStatus(project.status);

    return {
      id: stringValue(project.id) ?? '',
      name: stringValue(project.title) ?? 'Untitled project',
      status,
      statusLabel: this.projectStatusLabel(status),
      startDate: stringValue(project.startDate) ?? '',
      dueDate: stringValue(project.endDate) ?? '',
      group: 'Backend API',
      authorized: true,
    };
  }

  private toTaskRecord(task: TaskDto, projects: readonly ProjectMockRecord[]): TaskMockRecord {
    const status = taskStatus(task.status);
    const priority = taskPriority(task.priority);
    const projectId = stringValue(task.projectId) ?? projects[0]?.id ?? '';

    return {
      id: stringValue(task.id) ?? '',
      projectId,
      title: stringValue(task.title) ?? 'Untitled task',
      description: stringValue(task.description) ?? '',
      status,
      statusLabel: this.getStatusLabel(status),
      priority,
      priorityLabel: this.priorityLabel(priority),
      assignee: '',
      startDate: stringValue(task.startDate) ?? '',
      dueDate: stringValue(task.dueDate) ?? '',
      progressPercent: numberValue(task.progressPercent) ?? 0,
      milestone: stringValue(task.milestoneId) ?? '',
      dependencyIds: [],
      allowedTransitions: [],
      capabilities: [],
      authorized: true,
      rowVersion: '',
    };
  }

  private projectStatusLabel(status: ProjectStatus): string {
    return (
      {
        planning: 'Planning',
        active: 'Active',
        atRisk: 'At risk',
        complete: 'Complete',
      } satisfies Record<ProjectStatus, string>
    )[status];
  }

  private priorityLabel(priority: TaskPriority): string {
    return (
      {
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        urgent: 'Urgent',
      } satisfies Record<TaskPriority, string>
    )[priority];
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function enumText(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function projectStatus(value: unknown): ProjectStatus {
  const normalized = enumText(value);
  if (normalized === '0' || normalized === 'planning') {
    return 'planning';
  }
  if (normalized === '1' || normalized === 'active') {
    return 'active';
  }
  if (normalized === '3' || normalized === 'completed' || normalized === 'complete') {
    return 'complete';
  }
  return 'atRisk';
}

function taskStatus(value: unknown): TaskStatus {
  const normalized = enumText(value);
  if (normalized === '1' || normalized === 'inprogress') {
    return 'inProgress';
  }
  if (normalized === '2' || normalized === 'waitingreview' || normalized === 'review') {
    return 'review';
  }
  if (normalized === '3' || normalized === 'blocked') {
    return 'blocked';
  }
  if (normalized === '4' || normalized === 'completed' || normalized === 'done') {
    return 'done';
  }
  return 'notStarted';
}

function taskPriority(value: unknown): TaskPriority {
  const normalized = enumText(value);
  if (normalized === '0' || normalized === 'low') {
    return 'low';
  }
  if (normalized === '2' || normalized === 'high') {
    return 'high';
  }
  if (normalized === '3' || normalized === 'critical' || normalized === 'urgent') {
    return 'urgent';
  }
  return 'medium';
}
