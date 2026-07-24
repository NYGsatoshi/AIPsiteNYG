import { TaskPriority } from './projects.types';

export interface PagedResponseDto<T> {
  readonly items?: readonly T[];
  readonly page?: unknown;
  readonly pageSize?: unknown;
  readonly totalCount?: unknown;
  readonly hasMore?: unknown;
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
  readonly workspaceId?: unknown;
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
  readonly relationships?: TaskRelationshipsDto | null;
  readonly permissions?: TaskDetailPermissionsDto | null;
  readonly checklist?: readonly TaskChecklistDto[];
  readonly labels?: readonly TaskLabelDto[];
  readonly watchState?: TaskWatchStateDto | null;
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

export interface TaskPersonSummaryDto { readonly userId?: unknown; readonly displayName?: unknown; }
export interface TaskRelationshipsDto { readonly primaryAssignee?: TaskPersonSummaryDto | null; readonly targetGroupId?: unknown; readonly collaborators?: readonly TaskPersonSummaryDto[]; readonly reviewer?: TaskPersonSummaryDto | null; readonly version?: unknown; }
export interface TaskWatchStateDto { readonly isWatching?: unknown; readonly isExplicitOptOut?: unknown; readonly automaticSources?: readonly unknown[]; readonly version?: unknown; }
export interface TaskChecklistDto { readonly id?: unknown; readonly text?: unknown; readonly isCompleted?: unknown; readonly completedAt?: unknown; readonly completedByUserId?: unknown; readonly sortKey?: unknown; readonly version?: unknown; }
export interface TaskLabelDto { readonly id?: unknown; readonly name?: unknown; readonly description?: unknown; readonly sortKey?: unknown; readonly isArchived?: unknown; readonly version?: unknown; }
export interface TaskSubtaskDto { readonly id?: unknown; readonly parentTaskId?: unknown; readonly title?: unknown; readonly workflowStageId?: unknown; readonly workflowStageName?: unknown; readonly stageCategory?: unknown; readonly priority?: unknown; readonly progressPercent?: unknown; readonly primaryAssignee?: TaskPersonSummaryDto | null; readonly plannedEndDate?: unknown; readonly deadlineAt?: unknown; readonly isOverdue?: unknown; readonly version?: unknown; }
export interface TaskCommentMentionDto { readonly userId?: unknown; readonly displayName?: unknown; }
export interface TaskCommentDto { readonly id?: unknown; readonly taskId?: unknown; readonly author?: TaskPersonSummaryDto | null; readonly bodyPlainText?: unknown; readonly isImportant?: unknown; readonly mentions?: readonly TaskCommentMentionDto[]; readonly createdAt?: unknown; readonly updatedAt?: unknown; readonly deletedAt?: unknown; readonly version?: unknown; readonly canEdit?: unknown; readonly canDelete?: unknown; readonly canMarkImportant?: unknown; }
export interface TaskFileAssociationDto { readonly id?: unknown; readonly fileObjectId?: unknown; readonly fileName?: unknown; readonly contentType?: unknown; readonly sizeBytes?: unknown; readonly scanStatus?: unknown; readonly createdAt?: unknown; readonly accessState?: unknown; readonly canOpen?: unknown; readonly canRequestDownloadGrant?: unknown; readonly downloadGrantRequired?: unknown; readonly restrictionCode?: unknown; }
export interface TaskMentionCandidateDto { readonly userId?: unknown; readonly displayName?: unknown; }
export interface ReorderTaskChecklistRequestDto { readonly orderedItemIds: readonly string[]; readonly expectedTaskVersion: string | number; }
export interface TaskChecklistOrderResponseDto { readonly items?: readonly TaskChecklistDto[]; readonly taskVersion?: unknown; }

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
  readonly expectedVersion: number;
}

const taskPriorityApiValues: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3
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
  readonly expectedVersion: string;
}): UpdateTaskRequestDto {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    priority: taskPriorityApiValues[input.priority],
    startDate: nullableDate(input.startDate),
    dueDate: nullableDate(input.dueDate),
    progressPercent: input.progressPercent,
    expectedVersion: Number(input.expectedVersion)
  };
}

function nullableDate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
