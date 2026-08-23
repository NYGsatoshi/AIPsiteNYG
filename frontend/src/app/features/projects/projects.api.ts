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
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
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
  readonly tenantId?: unknown;
  readonly workspaceId?: unknown;
  readonly projectId?: unknown;
  readonly kind?: unknown;
  readonly parentTaskId?: unknown;
  readonly milestoneId?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly workflowStageId?: unknown;
  readonly workflowStageName?: unknown;
  readonly status?: unknown;
  readonly stageCategory?: unknown;
  readonly isBlocked?: unknown;
  readonly blockedReason?: unknown;
  readonly priority?: unknown;
  readonly startDate?: unknown;
  readonly dueDate?: unknown;
  readonly plannedStartDate?: unknown;
  readonly plannedEndDate?: unknown;
  readonly deadlineAt?: unknown;
  readonly actualStartAt?: unknown;
  readonly completedAt?: unknown;
  readonly progressPercent?: unknown;
  readonly progressIsDerived?: unknown;
  readonly estimatedEffortMinutes?: unknown;
  readonly primaryAssignee?: TaskPersonSummaryDto | null;
  readonly targetGroupId?: unknown;
  readonly collaboratorCount?: unknown;
  readonly reviewer?: TaskPersonSummaryDto | null;
  readonly isOverdue?: unknown;
  readonly dependencyWarnings?: readonly unknown[];
  readonly allowedTransitions?: readonly unknown[];
  readonly reviewStatus?: unknown;
  readonly subresources?: TaskSubresourceSummaryDto | null;
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
export interface TaskSubresourceSummaryDto { readonly checklistCompletedCount?: unknown; readonly checklistTotalCount?: unknown; readonly commentCount?: unknown; readonly labelCount?: unknown; readonly subtaskCount?: unknown; }
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

export interface ProjectKanbanWarningDto {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly workflowStageId?: unknown;
  readonly currentCount?: unknown;
  readonly limit?: unknown;
}

export interface ProjectKanbanBoardDto {
  readonly projectId?: unknown;
  readonly version?: unknown;
  readonly timeZone?: unknown;
  readonly defaultSwimlane?: unknown;
  readonly selectedSwimlane?: unknown;
  readonly supportedSwimlanes?: readonly unknown[];
  readonly supportedFilters?: readonly unknown[];
  readonly includesOlderCompleted?: unknown;
  readonly doneWindowDays?: unknown;
  readonly totalAuthorizedCardCount?: unknown;
  readonly isTruncated?: unknown;
  readonly uiPermissions?: { readonly canConfigure?: unknown } | null;
  readonly warnings?: readonly ProjectKanbanWarningDto[];
}

export interface ProjectKanbanColumnDto {
  readonly workflowStageId?: unknown;
  readonly displayName?: unknown;
  readonly category?: unknown;
  readonly displayOrder?: unknown;
  readonly wipWarningLimit?: unknown;
  readonly currentAuthorizedCardCount?: unknown;
  readonly hasWipWarning?: unknown;
  readonly uiPermissions?: { readonly canConfigure?: unknown } | null;
}

export interface ProjectKanbanCardDto {
  readonly taskId?: unknown;
  readonly summary?: unknown;
  readonly workflowStageId?: unknown;
  readonly boardOrder?: unknown;
  readonly parentTaskId?: unknown;
  readonly parentSummary?: unknown;
  readonly isParentSummary?: unknown;
  readonly isLeaf?: unknown;
  readonly completedChildCount?: unknown;
  readonly childCount?: unknown;
  readonly progressPercent?: unknown;
  readonly plannedStartDate?: unknown;
  readonly plannedEndDate?: unknown;
  readonly primaryAssigneeUserId?: unknown;
  readonly primaryAssigneeLabel?: unknown;
  readonly targetGroupId?: unknown;
  readonly targetGroupLabel?: unknown;
  readonly priority?: unknown;
  readonly isBlocked?: unknown;
  readonly version?: unknown;
  readonly swimlaneKey?: unknown;
  readonly swimlaneLabel?: unknown;
  readonly uiPermissions?: {
    readonly canOpen?: unknown;
    readonly canMove?: unknown;
    readonly allowedTargetWorkflowStageIds?: readonly unknown[];
  } | null;
}

export interface ProjectKanbanSnapshotDto {
  readonly board?: ProjectKanbanBoardDto | null;
  readonly columns?: readonly ProjectKanbanColumnDto[];
  readonly cards?: readonly ProjectKanbanCardDto[];
}

export interface ProjectKanbanCommandResponseDto {
  readonly snapshot?: ProjectKanbanSnapshotDto | null;
  readonly focusTaskId?: unknown;
  readonly warnings?: readonly ProjectKanbanWarningDto[];
}

/**
 * Canonical, vendor-neutral Project schedule projection.
 *
 * Date fields are ISO `yyyy-MM-dd` calendar dates. Consumers must not convert
 * them through `Date` or reinterpret them in the browser timezone.
 */
export interface ProjectGanttCalendarDto {
  readonly timeZone: string;
  readonly workingDays: readonly string[];
  readonly holidaysAvailable: boolean;
  readonly limitations: readonly string[];
}

export interface ProjectGanttWarningDto {
  readonly code: string;
  readonly message: string;
  readonly severity: 'Info' | 'Warning';
  readonly targetType: string;
  readonly targetId: string | null;
  readonly field: string | null;
  readonly blocking: boolean;
}

export interface ProjectGanttPermissionsDto {
  readonly canEditSchedule: boolean;
  readonly canEditProgress: boolean;
  readonly canManageDependencies: boolean;
  readonly canClearSchedule: boolean;
  readonly canOpen: boolean;
}

export interface ProjectGanttAssigneeDto {
  readonly userId: string;
  readonly displayName: string;
}

export interface ProjectGanttItemDto {
  readonly taskId: string;
  readonly kind: 'Task' | 'Milestone';
  readonly parentTaskId: string | null;
  readonly milestoneId: string | null;
  readonly title: string;
  readonly plannedStartDate: string | null;
  readonly plannedEndDate: string | null;
  readonly milestoneDate: string | null;
  readonly progressPercent: number;
  readonly progressIsDerived: boolean;
  readonly workflowStageId: string | null;
  readonly workflowStageName: string | null;
  readonly stageCategory: 'Backlog' | 'Todo' | 'InProgress' | 'Review' | 'Done' | 'Cancelled';
  readonly priority: 'Low' | 'Medium' | 'High' | 'Critical';
  readonly isBlocked: boolean;
  readonly primaryAssignee: ProjectGanttAssigneeDto | null;
  readonly version: number;
  readonly scheduleEditPermissions: ProjectGanttPermissionsDto;
  readonly warnings: readonly ProjectGanttWarningDto[];
}

export interface ProjectGanttDependencyDto {
  readonly dependencyId: string;
  readonly predecessorTaskId: string;
  readonly successorTaskId: string;
  readonly type: 'FinishToStart' | 'StartToStart' | 'FinishToFinish' | 'StartToFinish';
  readonly editable: boolean;
  readonly version: number;
  readonly warnings: readonly ProjectGanttWarningDto[];
}

export interface ProjectGanttSnapshotDto {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly projectVersion: number;
  readonly workflowVersion: number;
  readonly calendarVersion: number | null;
  readonly calendar: ProjectGanttCalendarDto;
  readonly scheduledItems: readonly ProjectGanttItemDto[];
  readonly unscheduledItems: readonly ProjectGanttItemDto[];
  readonly milestones: readonly ProjectGanttItemDto[];
  readonly dependencies: readonly ProjectGanttDependencyDto[];
  readonly warnings: readonly ProjectGanttWarningDto[];
  readonly permissions: ProjectGanttPermissionsDto;
  readonly maximumItems: number;
  readonly totalItems: number;
}

export interface UpdateTaskScheduleRequestDto {
  readonly plannedStartDate: string | null;
  readonly plannedEndDate: string | null;
  readonly milestoneDate: string | null;
  readonly expectedVersion: number;
}

export interface UpdateTaskProgressRequestDto {
  readonly progressPercent: number;
  readonly expectedVersion: number;
}

/** The current dependency route authors Finish-to-Start only. */
export interface AddTaskDependencyRequestDto {
  readonly predecessorTaskId: string;
  readonly dependencyType: 'FinishToStart';
  readonly expectedVersion: number;
}

export interface RemoveTaskDependencyRequestDto {
  readonly expectedVersion: number;
}

/** Existing PR02 dependency route response; the property converter serializes the enum name. */
export interface TaskDependencyCommandResponseDto {
  readonly id: string;
  readonly predecessorTaskId: string;
  readonly successorTaskId: string;
  readonly dependencyType: 'FinishToStart' | 'StartToStart' | 'FinishToFinish' | 'StartToFinish';
  readonly createdAt: string;
  readonly version: number;
  readonly editable: boolean;
  readonly warnings: readonly ProjectGanttWarningDto[];
}

export interface RemoveTaskDependencyResponseDto {
  readonly status: 'OK';
}

export interface ProjectGanttCommandResponseDto {
  readonly taskId: string;
  readonly kind: 'Task' | 'Milestone';
  readonly plannedStartDate: string | null;
  readonly plannedEndDate: string | null;
  readonly milestoneDate: string | null;
  readonly progressPercent: number;
  readonly version: number;
  readonly warnings: readonly ProjectGanttWarningDto[];
}

export interface MoveTaskOnKanbanRequestDto {
  readonly targetWorkflowStageId: string;
  readonly targetBeforeTaskId: string | null;
  readonly targetAfterTaskId: string | null;
  readonly expectedTaskVersion: number;
  readonly expectedBoardVersion: number;
  readonly reason: string | null;
}

export interface UpdateProjectKanbanConfigRequestDto {
  readonly expectedBoardVersion: number;
  readonly defaultSwimlane: number;
  readonly columns: readonly {
    readonly workflowStageId: string;
    readonly displayOrder: number;
    readonly wipWarningLimit: number | null;
  }[];
}

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
  readonly plannedStartDate: string | null;
  readonly plannedEndDate: string | null;
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
    plannedStartDate: nullableDate(input.startDate),
    plannedEndDate: nullableDate(input.dueDate),
    progressPercent: input.progressPercent,
    expectedVersion: Number(input.expectedVersion)
  };
}

function nullableDate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
