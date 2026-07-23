import { TaskPriority, TaskStatus } from './projects.types';

export interface PagedResponseDto<T> {
  readonly items?: readonly T[];
  readonly page?: unknown;
  readonly pageSize?: unknown;
  readonly totalCount?: unknown;
}

export interface ProjectUiPermissionDto {
  readonly canCreateTask?: unknown;
}

export interface ProjectDto {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly startDate?: unknown;
  readonly endDate?: unknown;
  readonly uiPermissions?: ProjectUiPermissionDto | null;
}

export interface TaskUiPermissionDto {
  readonly canEdit?: unknown;
  readonly canAssign?: unknown;
  readonly canChangeStatus?: unknown;
  readonly canDelete?: unknown;
  readonly allowedTransitions?: unknown;
  readonly rowVersion?: unknown;
  readonly canUpdate?: unknown;
}

export interface TaskDto {
  readonly id?: unknown;
  readonly projectId?: unknown;
  readonly milestoneId?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly status?: unknown;
  readonly stageCategory?: unknown;
  readonly isBlocked?: unknown;
  readonly priority?: unknown;
  readonly startDate?: unknown;
  readonly dueDate?: unknown;
  readonly plannedStartDate?: unknown;
  readonly plannedEndDate?: unknown;
  readonly progressPercent?: unknown;
  readonly uiPermissions?: TaskUiPermissionDto | null;
  readonly version?: unknown;
}

/** The detail endpoint deliberately wraps compact task command state in a bounded aggregate. */
export interface CanonicalTaskDetailDto {
  readonly task?: TaskDto | null;
  readonly relationships?: Record<string, unknown> | null;
  readonly permissions?: TaskDetailPermissionsDto | null;
  readonly checklist?: readonly TaskChecklistDto[];
  readonly labels?: readonly TaskLabelDto[];
  readonly watchState?: Record<string, unknown> | null;
  readonly subtasks?: PagedResponseDto<TaskSubtaskDto> | null;
  readonly comments?: PagedResponseDto<TaskCommentDto> | null;
  readonly files?: PagedResponseDto<TaskFileAssociationDto> | null;
}

export interface TaskDetailPermissionsDto {
  readonly canCreateSubtask?: unknown;
  readonly canCreateChecklistItem?: unknown;
  readonly canUpdateChecklistItems?: unknown;
  readonly canDeleteChecklistItems?: unknown;
  readonly canReorderChecklist?: unknown;
  readonly canCreateComment?: unknown;
  readonly canMarkCommentImportant?: unknown;
  readonly canApplyLabels?: unknown;
  readonly canManageLabelDefinitions?: unknown;
  readonly canAssociateFiles?: unknown;
  readonly canRemoveFiles?: unknown;
  readonly canChangeWatch?: unknown;
}

export interface TaskChecklistDto { readonly id?: unknown; readonly text?: unknown; readonly isCompleted?: unknown; readonly version?: unknown; }
export interface TaskLabelDto { readonly id?: unknown; readonly name?: unknown; readonly isArchived?: unknown; }
export interface TaskSubtaskDto { readonly id?: unknown; readonly parentTaskId?: unknown; readonly title?: unknown; readonly workflowStageName?: unknown; readonly stageCategory?: unknown; readonly priority?: unknown; readonly progressPercent?: unknown; readonly version?: unknown; }
export interface TaskCommentDto { readonly id?: unknown; readonly bodyPlainText?: unknown; readonly isImportant?: unknown; readonly canMarkImportant?: unknown; }
export interface TaskFileAssociationDto { readonly id?: unknown; readonly fileName?: unknown; readonly accessState?: unknown; readonly canOpen?: unknown; readonly canRequestDownloadGrant?: unknown; readonly restrictionCode?: unknown; }

export interface MyTaskDto {
  readonly taskId?: unknown;
  /** @deprecated PR04 consumers use stageCategory and plannedEndDate. */
  readonly dueDate?: unknown;
  /** @deprecated PR04 consumers use stageCategory. */
  readonly status?: unknown;
  readonly tenantId?: unknown;
  readonly workspaceId?: unknown;
  readonly workspaceTitle?: unknown;
  readonly projectId?: unknown;
  readonly projectTitle?: unknown;
  readonly kind?: unknown;
  readonly parentTaskId?: unknown;
  readonly title?: unknown;
  readonly workflowStageId?: unknown;
  readonly workflowStageName?: unknown;
  readonly stageCategory?: unknown;
  readonly priority?: unknown;
  readonly isBlocked?: unknown;
  readonly plannedStartDate?: unknown;
  readonly plannedEndDate?: unknown;
  readonly deadlineAt?: unknown;
  readonly progressPercent?: unknown;
  readonly progressIsDerived?: unknown;
  readonly primaryAssignee?: { readonly userId?: unknown; readonly displayName?: unknown } | null;
  readonly targetGroup?: { readonly groupId?: unknown; readonly name?: unknown } | null;
  readonly reviewer?: { readonly userId?: unknown; readonly displayName?: unknown } | null;
  readonly labels?: readonly { readonly labelId?: unknown; readonly name?: unknown }[];
  readonly checklistCompletedCount?: unknown;
  readonly checklistTotalCount?: unknown;
  readonly relationships?: Record<string, unknown> | null;
  readonly timeGroup?: unknown;
  readonly isOverdue?: unknown;
  readonly version?: unknown;
  readonly quickEditPermissions?: Record<string, unknown> | null;
  readonly warnings?: readonly unknown[];
}

export interface MyTasksProjectionPageDto {
  readonly items?: readonly MyTaskDto[];
  readonly page?: unknown;
  readonly pageSize?: unknown;
  readonly totalCount?: unknown;
  readonly view?: unknown;
  readonly scope?: unknown;
  readonly workspaceId?: unknown;
  readonly availableWorkspaceCount?: unknown;
}

export interface MyTasksCountsDto {
  readonly scope?: unknown;
  readonly workspaceId?: unknown;
  readonly availableWorkspaceCount?: unknown;
  readonly views?: readonly { readonly view?: unknown; readonly count?: unknown }[];
  readonly timeGroups?: readonly { readonly timeGroup?: unknown; readonly count?: unknown }[];
}

export interface CreateTaskRequestDto {
  readonly milestoneId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly priority: number;
  readonly startDate: string | null;
  readonly dueDate: string | null;
}

export interface UpdateTaskRequestDto {
  readonly title: string;
  readonly description: string;
  readonly priority: number;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly progressPercent: number;
  readonly status?: number;
}

const taskPriorityApiValues: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3
};

const taskStatusApiValues: Record<TaskStatus, number> = {
  notStarted: 0,
  inProgress: 1,
  review: 2,
  blocked: 3,
  done: 4,
  cancelled: 5
};

export function toCreateTaskRequestDto(input: {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly startDate: string;
  readonly dueDate: string;
}): CreateTaskRequestDto {
  return {
    milestoneId: null,
    title: input.title.trim(),
    description: input.description.trim().length > 0 ? input.description.trim() : null,
    priority: taskPriorityApiValues[input.priority],
    startDate: nullableDate(input.startDate),
    dueDate: nullableDate(input.dueDate)
  };
}

export function toUpdateTaskRequestDto(input: {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly startDate: string;
  readonly dueDate: string;
  readonly progressPercent: number;
  readonly status?: TaskStatus;
}): UpdateTaskRequestDto {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    priority: taskPriorityApiValues[input.priority],
    startDate: nullableDate(input.startDate),
    dueDate: nullableDate(input.dueDate),
    progressPercent: input.progressPercent,
    ...(input.status ? { status: taskStatusApiValues[input.status] } : {})
  };
}

function nullableDate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
