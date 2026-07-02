import { inject, Injectable, InjectionToken } from '@angular/core';

import {
  PROJECTS_DEFAULT_PAGE_SIZE,
  PROJECTS_MAXIMUM_PAGE_SIZE,
  ProjectMockRecord,
  ProjectSummaryViewModel,
  ProjectsOverviewViewModel,
  ProjectsScenario,
  TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
  TaskDetailViewModel,
  TaskGridRow,
  TaskMockRecord,
  TaskRowAction,
  MyTasksViewModel
} from './projects.types';
import { PROJECTS_PRIMARY_PROJECT_ID, PROJECTS_PRIMARY_TASK_ID, PROJECTS_SCENARIOS } from './projects.mock';

export const AIP_PROJECTS_MOCK = new InjectionToken<ProjectsScenario>('AIP_PROJECTS_MOCK');

@Injectable({
  providedIn: 'root'
})
export class ProjectsFacade {
  private readonly scenario: ProjectsScenario =
    inject(AIP_PROJECTS_MOCK, { optional: true }) ?? PROJECTS_SCENARIOS.default;

  getProjectsOverview(): ProjectsOverviewViewModel {
    if (this.scenario.status === 'permissionDenied') {
      return this.emptyOverview('permissionDenied', this.scenario.message);
    }

    const projects = this.authorizedProjects().map((project) => this.toProjectSummary(project));
    const rows = this.authorizedTasks().map((task) => this.toTaskRow(task));

    return {
      status: this.scenario.status,
      title: this.scenario.title,
      subtitle: this.scenario.subtitle,
      projects,
      rows,
      columns: [],
      pageSize: this.pageSize,
      message: this.scenario.message
    };
  }

  getMyTasks(): MyTasksViewModel {
    if (this.scenario.status === 'permissionDenied') {
      return {
        status: 'permissionDenied',
        title: 'My tasks',
        subtitle: 'Already-authorized mock assignments',
        rows: [],
        columns: [],
        pageSize: this.pageSize,
        message: this.scenario.message
      };
    }

    return {
      status: this.scenario.status,
      title: 'My tasks',
      subtitle: 'Already-authorized mock assignments',
      rows: this.authorizedTasks()
        .filter((task) => task.assignee === this.scenario.currentUserAssignee)
        .map((task) => this.toTaskRow(task)),
      columns: [],
      pageSize: this.pageSize,
      message: this.scenario.message
    };
  }

  getTaskDetail(projectId = PROJECTS_PRIMARY_PROJECT_ID, taskId = PROJECTS_PRIMARY_TASK_ID): TaskDetailViewModel {
    if (this.scenario.status === 'permissionDenied') {
      return {
        status: 'permissionDenied',
        detailState: 'ready',
        dependencies: [],
        capabilities: [],
        transitionNote: TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
        message: this.scenario.message
      };
    }

    const task =
      this.authorizedTasks().find((candidate) => candidate.projectId === projectId && candidate.id === taskId) ??
      this.authorizedTasks()[0];
    const project = task ? this.authorizedProjects().find((candidate) => candidate.id === task.projectId) : undefined;

    return {
      status: task && project ? this.scenario.status : 'empty',
      detailState: this.scenario.detailState ?? 'ready',
      project: project ? this.toProjectSummary(project) : undefined,
      task: task ? this.toTaskRow(task) : undefined,
      editorTask: task,
      dependencies: task ? this.toDependencies(task) : [],
      capabilities: task?.capabilities ?? [],
      transitionNote: TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
      message: this.scenario.message
    };
  }

  getStatusLabel(status: TaskGridRow['status']): string {
    return (
      {
        notStarted: 'Not started',
        inProgress: 'In progress',
        blocked: 'Blocked',
        review: 'Review',
        done: 'Done'
      } satisfies Record<TaskGridRow['status'], string>
    )[status];
  }

  private emptyOverview(status: ProjectsOverviewViewModel['status'], message?: string): ProjectsOverviewViewModel {
    return {
      status,
      title: this.scenario.title,
      subtitle: this.scenario.subtitle,
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
    return this.scenario.projects.filter((project) => project.authorized);
  }

  private authorizedTasks(): readonly TaskMockRecord[] {
    const authorizedProjectIds = new Set(this.authorizedProjects().map((project) => project.id));
    return this.scenario.tasks.filter((task) => task.authorized && authorizedProjectIds.has(task.projectId));
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
      }
    };
  }

  private toTaskRow(task: TaskMockRecord): TaskGridRow {
    const projectName = this.authorizedProjects().find((project) => project.id === task.projectId)?.name ?? 'Project';

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
        disabled: false,
        mobileHidden: this.scenario.mobile
      });
    }

    if (task.capabilities.includes('changeTaskStatus')) {
      actions.push({
        id: 'changeStatus',
        label: 'Status',
        disabled: task.allowedTransitions.length === 0,
        disabledReason:
          task.allowedTransitions.length === 0 ? 'No backend-provided transition is currently allowed.' : undefined,
        mobileHidden: this.scenario.mobile
      });
    }

    return actions.filter((action) => !action.mobileHidden);
  }

  private toDependencies(task: TaskMockRecord) {
    return task.dependencyIds
      .map((dependencyId) => this.authorizedTasks().find((candidate) => candidate.id === dependencyId))
      .filter((dependency): dependency is TaskMockRecord => dependency !== undefined)
      .map((dependency) => ({
        id: dependency.id,
        title: dependency.title,
        status: dependency.status
      }));
  }
}
