import { MyTaskDto, ProjectDto, TaskDto } from './projects.api';
import {
  ProjectCapability,
  ProjectMockRecord,
  ProjectStatus,
  TaskMockRecord,
  MyTasksLiveTask,
  TaskPriority,
  TaskStatus
} from './projects.types';

export function mapProjectDtoToRecord(project: ProjectDto): ProjectMockRecord {
  const status = mapProjectStatus(project.status);

  return {
    id: requiredString(project.id, 'project.id'),
    name: stringValue(project.title) ?? 'Untitled project',
    status,
    statusLabel: projectStatusLabel(status),
    startDate: stringValue(project.startDate) ?? '',
    dueDate: stringValue(project.endDate) ?? '',
    group: 'Group not shown by API',
    authorized: true,
    canCreateTask: project.uiPermissions?.canCreateTask === true
  };
}

export function mapTaskDtoToRecord(
  task: TaskDto,
  _projects: readonly ProjectMockRecord[]
): TaskMockRecord {
  const status = task.isBlocked === true ? 'blocked' : mapTaskStatus(task.stageCategory ?? task.status);
  const priority = mapTaskPriority(task.priority);
  const projectId = requiredString(task.projectId, 'task.projectId');
  const allowedTransitions = taskStatusArray(task.uiPermissions?.allowedTransitions);

  return {
    id: requiredString(task.id, 'task.id'),
    projectId,
    title: stringValue(task.title) ?? 'Untitled task',
    description: stringValue(task.description) ?? '',
    status,
    statusLabel: taskStatusLabel(status),
    priority,
    priorityLabel: taskPriorityLabel(priority),
    assignee: 'Assignment not shown by API',
    startDate: stringValue(task.plannedStartDate) ?? stringValue(task.startDate) ?? '',
    dueDate: stringValue(task.plannedEndDate) ?? stringValue(task.dueDate) ?? '',
    progressPercent: numberValue(task.progressPercent) ?? 0,
    progressIsDerived: task.progressIsDerived === true,
    milestone: stringValue(task.milestoneId) ?? '',
    dependencyIds: [],
    allowedTransitions,
    capabilities: taskCapabilities(task.uiPermissions, allowedTransitions),
    authorized: true,
    rowVersion: stringValue(task.uiPermissions?.rowVersion) ?? stringValue(task.version) ?? ''
  };
}

export function mapMyTaskDtoToRecord(task: MyTaskDto): TaskMockRecord {
  const status = mapTaskStatus(task.status);
  const priority = mapTaskPriority(task.priority);

  return {
    id: requiredString(task.taskId, 'myTask.taskId'),
    projectId: requiredString(task.projectId, 'myTask.projectId'),
    title: stringValue(task.title) ?? 'Untitled task',
    description: '',
    status,
    statusLabel: taskStatusLabel(status),
    priority,
    priorityLabel: taskPriorityLabel(priority),
    assignee: 'Assigned to you',
    startDate: '',
    dueDate: stringValue(task.dueDate) ?? '',
    progressPercent: null,
    progressIsDerived: false,
    milestone: stringValue(task.projectTitle) ?? '',
    dependencyIds: [],
    allowedTransitions: [],
    capabilities: [],
    authorized: true,
    rowVersion: ''
  };
}

/** Maps only the PR04 canonical projection.  Legacy TaskMockRecord is never used for live My Tasks state. */
export function mapMyTaskDtoToProjection(task: MyTaskDto): MyTasksLiveTask {
  const stage = mapTaskStatus(task.stageCategory);
  const priority = mapTaskPriority(task.priority);
  const timeGroup = mapTimeGroup(task.timeGroup);
  const permissions = task.quickEditPermissions;
  return {
    taskId: requiredString(task.taskId, 'myTask.taskId'),
    tenantId: requiredString(task.tenantId, 'myTask.tenantId'),
    workspaceId: requiredString(task.workspaceId, 'myTask.workspaceId'),
    workspaceTitle: requiredString(task.workspaceTitle, 'myTask.workspaceTitle'),
    projectId: requiredString(task.projectId, 'myTask.projectId'),
    projectTitle: requiredString(task.projectTitle, 'myTask.projectTitle'),
    title: requiredString(task.title, 'myTask.title'),
    workflowStageId: stringValue(task.workflowStageId) ?? null,
    workflowStageName: stringValue(task.workflowStageName) ?? taskStatusLabel(stage),
    status: stage,
    priority,
    isBlocked: task.isBlocked === true,
    plannedEndDate: stringValue(task.plannedEndDate) ?? '',
    deadlineAt: stringValue(task.deadlineAt) ?? '',
    progressPercent: numberValue(task.progressPercent) ?? 0,
    timeGroup,
    isOverdue: task.isOverdue === true,
    version: requiredVersion(task.version),
    primaryAssignee: personName(task.primaryAssignee),
    targetGroup: groupName(task.targetGroup),
    reviewer: personName(task.reviewer),
    labels: Array.isArray(task.labels) ? task.labels.map((label) => stringValue(label.name)).filter((name): name is string => !!name) : [],
    checklistCompletedCount: numberValue(task.checklistCompletedCount) ?? 0,
    checklistTotalCount: numberValue(task.checklistTotalCount) ?? 0,
    canClaim: permissions?.['canClaim'] === true,
    canChangeStage: permissions?.['canChangeStage'] === true,
    warnings: Array.isArray(task.warnings) ? task.warnings.filter((warning): warning is string => typeof warning === 'string') : []
  };
}

export function mapProjectStatus(value: unknown): ProjectStatus {
  const normalized = enumText(value);
  if (normalized === '0' || normalized === 'planning') {
    return 'planning';
  }
  if (normalized === '1' || normalized === 'active') {
    return 'active';
  }
  if (normalized === '2' || normalized === 'review') {
    return 'review';
  }
  if (normalized === '3' || normalized === 'completed' || normalized === 'complete') {
    return 'complete';
  }
  if (normalized === '4' || normalized === 'suspended') {
    return 'suspended';
  }
  if (normalized === '5' || normalized === '6' || normalized === 'archived' || normalized === 'deleted') {
    return 'archived';
  }
  return 'atRisk';
}

export function mapTaskStatus(value: unknown): TaskStatus {
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
  if (normalized === '5' || normalized === 'cancelled' || normalized === 'canceled') {
    return 'cancelled';
  }
  return 'notStarted';
}

export function mapTaskPriority(value: unknown): TaskPriority {
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

export function projectStatusLabel(status: ProjectStatus): string {
  return (
    {
      planning: 'Planning',
      active: 'Active',
      review: 'Review',
      atRisk: 'At risk',
      complete: 'Complete',
      suspended: 'Suspended',
      archived: 'Archived'
    } satisfies Record<ProjectStatus, string>
  )[status];
}

export function taskStatusLabel(status: TaskStatus): string {
  return (
    {
      notStarted: 'Not started',
      inProgress: 'In progress',
      blocked: 'Blocked',
      review: 'Review',
      done: 'Done',
      cancelled: 'Cancelled'
    } satisfies Record<TaskStatus, string>
  )[status];
}

export function taskPriorityLabel(priority: TaskPriority): string {
  return (
    {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      urgent: 'Urgent'
    } satisfies Record<TaskPriority, string>
  )[priority];
}

function taskCapabilities(
  uiPermissions: TaskDto['uiPermissions'],
  allowedTransitions: readonly TaskStatus[]
): readonly ProjectCapability[] {
  const capabilities: ProjectCapability[] = [];
  if (uiPermissions?.canEdit === true || uiPermissions?.canUpdate === true) {
    capabilities.push('editTask');
  }
  if (uiPermissions?.canAssign === true) {
    capabilities.push('assignTask');
  }
  if (uiPermissions?.canChangeStatus === true && allowedTransitions.length > 0) {
    capabilities.push('changeTaskStatus');
  }

  return capabilities;
}

function taskStatusArray(value: unknown): readonly TaskStatus[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => mapTaskStatus(item));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown, fieldName: string): string {
  const text = stringValue(value);
  if (text) {
    return text;
  }

  throw new Error(`Projects API response did not include ${fieldName}.`);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function enumText(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function requiredVersion(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error('Projects API response did not include myTask.version.');
}

function mapTimeGroup(value: unknown): MyTasksLiveTask['timeGroup'] {
  switch (enumText(value)) {
    case 'overdue': return 'overdue';
    case 'today': return 'today';
    case 'next7days': return 'next7Days';
    case 'later': return 'later';
    default: return 'noDeadline';
  }
}

function personName(value: MyTaskDto['primaryAssignee']): string {
  return value && stringValue(value.displayName) ? stringValue(value.displayName)! : 'Unassigned';
}

function groupName(value: MyTaskDto['targetGroup']): string {
  return value && stringValue(value.name) ? stringValue(value.name)! : '';
}
