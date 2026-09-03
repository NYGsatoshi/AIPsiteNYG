import { WorkStatus, workStatusLabel } from '../../shared/ui/work-status/work-status';
import { MyTaskDto, ProjectDto, TaskDto } from './projects.api';
import {
  ProjectCapability,
  ProjectActivationState,
  ProjectMockRecord,
  ProjectStatus,
  ProjectVisibility,
  TaskMockRecord,
  TaskBriefFieldViewModel,
  TaskBriefViewModel,
  MyTasksLiveTask,
  TaskPriority,
  TaskStageCategory,
  TaskStatus
} from './projects.types';

export function mapProjectDtoToRecord(project: ProjectDto): ProjectMockRecord {
  const status = mapProjectStatus(project.status);
  const activationState = mapProjectActivationState(project.activationState);
  const visibility = mapProjectVisibility(project.visibility);
  const versionNo = positiveSafeInteger(project.versionNo) ?? 0;
  const hasCanonicalDraftLifecycle = activationState === 'neverActivated' && status === 'planning';
  const hasCanonicalDraftProvenance = project.activatedAtUtc === null &&
    project.activationVersion === null;
  const isCanonicalDraft = hasCanonicalDraftLifecycle &&
    visibility !== 'unknown' &&
    hasCanonicalDraftProvenance;
  // Canonical creation introduces one explicit non-operational shape. Existing
  // readable Projects (including Review and migrated LegacyUnknown records)
  // retain their established projections until the backend says otherwise.
  const isOperational = !hasCanonicalDraftLifecycle;

  return {
    id: requiredString(project.id, 'project.id'),
    workspaceId: nullableIdentifier(project.workspaceId),
    groupId: nullableIdentifier(project.groupId),
    ownerUserId: nullableIdentifier(project.ownerUserId),
    name: stringValue(project.title) ?? 'Untitled project',
    description: typeof project.description === 'string' ? project.description : '',
    status,
    statusLabel: projectStatusLabel(status),
    visibility,
    visibilityLabel: projectVisibilityLabel(visibility),
    activationState,
    versionNo,
    isOperational,
    startDate: stringValue(project.startDate) ?? '',
    dueDate: stringValue(project.endDate) ?? '',
    updatedAt: stringValue(project.updatedAt) ?? stringValue(project.createdAt) ?? '',
    group: nullableIdentifier(project.groupId) ? 'Assigned Group' : 'No Group',
    authorized: true,
    canCreateTask: isOperational && project.uiPermissions?.canCreateTask === true,
    canActivate:
      project.uiPermissions?.canActivate === true &&
      isCanonicalDraft &&
      versionNo > 0
  };
}

export function mapProjectVisibility(value: unknown): ProjectVisibility {
  switch (enumText(value)) {
    case '0':
    case 'workspacevisible':
      return 'workspaceVisible';
    case '1':
    case 'membersonly':
      return 'membersOnly';
    case '2':
    case 'restricted':
      return 'restricted';
    default:
      return 'unknown';
  }
}

export function projectVisibilityLabel(visibility: ProjectVisibility): string {
  switch (visibility) {
    case 'workspaceVisible': return 'Workspace visible';
    case 'membersOnly': return 'Members only';
    case 'restricted': return 'Restricted';
    default: return 'Visibility unavailable';
  }
}

export function mapProjectActivationState(value: unknown): ProjectActivationState {
  switch (enumText(value)) {
    case '1':
    case 'neveractivated':
      return 'neverActivated';
    case '2':
    case 'activated':
      return 'activated';
    default:
      return 'legacyUnknown';
  }
}

export function mapTaskDtoToRecord(
  task: TaskDto,
  _projects: readonly ProjectMockRecord[]
): TaskMockRecord {
  // Project Task lists retain the legacy `status` field and serialize the
  // additive category as a string.  The older canonical Task-detail contract
  // has no `status` field and still serializes the category ordinal.  Keep the
  // two numeric vocabularies separate so Review (canonical 3) can never be
  // mistaken for legacy Blocked (legacy 3).
  const canonicalStageCategory = mapTaskStageCategory(
    task.stageCategory,
    task.status === undefined || task.status === null
  );
  const legacyStatus = mapTaskStatus(task.status);
  const status = canonicalStageCategory
    ? taskStatusFromStageCategory(canonicalStageCategory)
    : legacyStatus;
  const stageCategory = canonicalStageCategory ?? taskStageCategoryFromStatus(legacyStatus);
  const isBlocked = task.isBlocked === true ||
    (task.isBlocked !== false && !canonicalStageCategory && legacyStatus === 'blocked');
  const priority = mapTaskPriority(task.priority);
  const projectId = requiredString(task.projectId, 'task.projectId');
  const allowedTransitions = taskStatusArray(task.uiPermissions?.allowedTransitions);
  const workflowStageName = stringValue(task.workflowStageName) ?? taskStageCategoryLabel(stageCategory);

  return {
    id: requiredString(task.id, 'task.id'),
    projectId,
    title: stringValue(task.title) ?? 'Untitled task',
    description: stringValue(task.description) ?? '',
    ...(task.brief ? { brief: mapTaskBrief(task.brief) } : {}),
    status,
    statusLabel: taskStatusLabel(status),
    workflowStageId: stringValue(task.workflowStageId) ?? null,
    workflowStageName,
    stageCategory,
    isBlocked,
    createdAt: stringValue(task.createdAt) ?? '',
    updatedAt: stringValue(task.updatedAt) ?? '',
    hasArtifact: typeof task.hasArtifact === 'boolean' ? task.hasArtifact : undefined,
    priority,
    priorityLabel: taskPriorityLabel(priority),
    assignee: stringValue(task.primaryAssignee?.displayName) ?? 'Unassigned',
    startDate: stringValue(task.plannedStartDate) ?? stringValue(task.startDate) ?? '',
    dueDate: stringValue(task.plannedEndDate) ?? stringValue(task.dueDate) ?? '',
    progressPercent: numberValue(task.progressPercent) ?? 0,
    progressIsDerived: task.progressIsDerived === true,
    milestone: stringValue(task.milestoneId) ?? '',
    dependencyIds: [],
    allowedTransitions,
    capabilities: taskCapabilities(task.uiPermissions, allowedTransitions),
    authorized: true,
    rowVersion: versionValue(task.uiPermissions?.rowVersion) ?? versionValue(task.version) ?? ''
  };
}

function mapTaskBrief(brief: TaskDto['brief']): TaskBriefViewModel {
  return {
    goal: mapTaskBriefField(brief?.goal),
    deliverable: mapTaskBriefField(brief?.deliverable),
    constraints: mapTaskBriefField(brief?.constraints)
  };
}

function mapTaskBriefField(field: { readonly value?: unknown; readonly source?: unknown } | null | undefined): TaskBriefFieldViewModel {
  const value = stringValue(field?.value) ?? null;
  return field?.source === 'taskSpecific' && value !== null
    ? { value, source: 'taskSpecific' }
    : { value: null, source: 'notSet' };
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
  const canonicalStageCategory = mapTaskStageCategory(task.stageCategory);
  const stage = canonicalStageCategory
    ? taskStatusFromStageCategory(canonicalStageCategory)
    : mapTaskStatus(task.status);
  const stageCategory = canonicalStageCategory ?? taskStageCategoryFromStatus(stage);
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
    stageCategory,
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

/**
 * Parses the canonical category string. Numeric values are accepted only when
 * the caller has positively identified the older canonical Task-detail DTO,
 * which omits the legacy `status` discriminator. Numeric list values belong to
 * TaskItemStatus and must never be interpreted as category ordinals.
 */
export function mapTaskStageCategory(
  value: unknown,
  allowCanonicalNumeric = false
): TaskStageCategory | undefined {
  if (allowCanonicalNumeric && typeof value === 'number' && Number.isInteger(value)) {
    switch (value) {
      case 0: return 'backlog';
      case 1: return 'todo';
      case 2: return 'inProgress';
      case 3: return 'review';
      case 4: return 'done';
      case 5: return 'cancelled';
      default: return undefined;
    }
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  switch (enumText(value)) {
    case 'backlog': return 'backlog';
    case 'todo': return 'todo';
    case 'inprogress': return 'inProgress';
    case 'review': return 'review';
    case 'done': return 'done';
    case 'cancelled':
    case 'canceled': return 'cancelled';
    default: return undefined;
  }
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

export function projectWorkStatus(status: ProjectStatus): WorkStatus {
  return (
    {
      planning: 'draft',
      active: 'running',
      review: 'needsReview',
      atRisk: 'needsAttention',
      complete: 'completed',
      suspended: 'paused',
      archived: 'archived'
    } satisfies Record<ProjectStatus, WorkStatus>
  )[status];
}

export function projectStatusLabel(status: ProjectStatus): string {
  return workStatusLabel(projectWorkStatus(status));
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

export function taskStageCategoryLabel(category: TaskStageCategory): string {
  return (
    {
      backlog: 'Backlog',
      todo: 'To do',
      inProgress: 'In progress',
      review: 'Needs review',
      done: 'Done',
      cancelled: 'Cancelled'
    } satisfies Record<TaskStageCategory, string>
  )[category];
}

export function taskStageWorkStatus(category: TaskStageCategory): WorkStatus {
  return (
    {
      backlog: 'draft',
      todo: 'ready',
      inProgress: 'running',
      review: 'needsReview',
      done: 'completed',
      cancelled: 'cancelled'
    } satisfies Record<TaskStageCategory, WorkStatus>
  )[category];
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

function taskStatusFromStageCategory(category: TaskStageCategory): TaskStatus {
  return (
    {
      backlog: 'notStarted',
      todo: 'notStarted',
      inProgress: 'inProgress',
      review: 'review',
      done: 'done',
      cancelled: 'cancelled'
    } satisfies Record<TaskStageCategory, TaskStatus>
  )[category];
}

export function taskStageCategoryFromStatus(status: TaskStatus): TaskStageCategory {
  return (
    {
      notStarted: 'todo',
      inProgress: 'inProgress',
      blocked: 'todo',
      review: 'review',
      done: 'done',
      cancelled: 'cancelled'
    } satisfies Record<TaskStatus, TaskStageCategory>
  )[status];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function versionValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : undefined;
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

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function nullableIdentifier(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function enumText(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function requiredVersion(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {return value;}
  if (typeof value === 'number' && Number.isFinite(value)) {return String(value);}
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
