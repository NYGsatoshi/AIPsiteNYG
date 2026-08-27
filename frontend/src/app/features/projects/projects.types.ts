import { AppDataGridColumnDef } from '../../shared/grid/app-data-grid/app-data-grid.types';
import { FrontendApiError } from '../../core/api/api-error.model';

export const PROJECTS_DEFAULT_PAGE_SIZE = 50;
export const PROJECTS_MAXIMUM_PAGE_SIZE = 100;

export type ProjectsPageStatus = 'ready' | 'loading' | 'empty' | 'permissionDenied' | 'error';
export type ProjectStatus = 'planning' | 'active' | 'review' | 'atRisk' | 'complete' | 'suspended' | 'archived';
export type ProjectVisibility = 'workspaceVisible' | 'membersOnly' | 'restricted' | 'unknown';
export type ProjectActivationState = 'legacyUnknown' | 'neverActivated' | 'activated';
export type TaskStatus = 'notStarted' | 'inProgress' | 'blocked' | 'review' | 'done' | 'cancelled';
export type TaskStageCategory = 'backlog' | 'todo' | 'inProgress' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskRowActionId = 'openDetail' | 'edit' | 'assign' | 'changeStatus';
export type TaskDetailState = 'ready' | 'rowVersionConflict' | 'invalidStateTransition';
export type ProjectCapability = 'editTask' | 'assignTask' | 'changeTaskStatus' | 'editMilestone';

export type TaskMutationState =
  | { readonly status: 'idle' }
  | { readonly status: 'submitting' }
  | { readonly status: 'refreshingAfterSave' }
  | { readonly status: 'success' }
  | { readonly status: 'savedButRefreshFailed'; readonly message: string; readonly requestId?: string }
  | { readonly status: 'failure'; readonly message: string; readonly requestId?: string }
  | { readonly status: 'conflict'; readonly message: string; readonly serverVersion?: unknown; readonly requestId?: string }
  | { readonly status: 'validation'; readonly message: string; readonly requestId?: string }
  | { readonly status: 'rateLimited'; readonly message: string; readonly requestId?: string };

export type TaskConflictReloadState = 'idle' | 'loading' | 'error';

/** State is deliberately scoped: an unrelated Task section must never disable another one. */
export type TaskDetailSection = 'detail' | 'activity' | 'subtasks' | 'checklist' | 'comments' | 'labels' | 'watch' | 'files';
export type TaskDetailSectionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'submitting' | 'success' | 'error' | 'permissionDenied' | 'conflict';
export interface TaskDetailSectionState {
  readonly status: TaskDetailSectionStatus;
  readonly message?: string;
  readonly requestId?: string;
  readonly retryable?: boolean;
  /** Keeps a failed page retry separate from an authoritative aggregate reload. */
  readonly retryKind?: 'page' | 'aggregate' | 'authorization';
  readonly failedPage?: number;
}

export interface BackendAuthoritativeTransitionNote {
  readonly owner: 'backendAuthoritativeDuringApiWiring';
  readonly message: string;
}

export const TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE: BackendAuthoritativeTransitionNote = {
  owner: 'backendAuthoritativeDuringApiWiring',
  message:
    'Mock UI uses backend-provided allowedTransitions later; the live API remains authoritative for task status transitions.'
};

export interface TaskDependencyViewModel {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
}

export interface ProjectMockRecord {
  readonly id: string;
  readonly workspaceId?: string | null;
  readonly groupId?: string | null;
  readonly ownerUserId?: string | null;
  readonly name: string;
  readonly description?: string;
  readonly status: ProjectStatus;
  readonly statusLabel: string;
  readonly visibility?: ProjectVisibility;
  readonly visibilityLabel?: string;
  readonly activationState?: ProjectActivationState;
  readonly versionNo?: number;
  readonly isOperational?: boolean;
  readonly startDate: string;
  readonly dueDate: string;
  readonly updatedAt: string;
  readonly group: string;
  readonly authorized: boolean;
  readonly canCreateTask: boolean;
  readonly canActivate?: boolean;
}

export interface TaskMockRecord {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly brief?: TaskBriefViewModel;
  readonly status: TaskStatus;
  readonly statusLabel: string;
  readonly workflowStageId?: string | null;
  readonly workflowStageName?: string;
  readonly stageCategory?: TaskStageCategory;
  readonly isBlocked?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly hasArtifact?: boolean;
  readonly priority: TaskPriority;
  readonly priorityLabel: string;
  readonly assignee: string;
  readonly startDate: string;
  readonly dueDate: string;
    readonly progressPercent: number | null;
    readonly progressIsDerived?: boolean;
  readonly milestone: string;
  readonly dependencyIds: readonly string[];
  readonly allowedTransitions: readonly TaskStatus[];
  readonly capabilities: readonly ProjectCapability[];
  readonly authorized: boolean;
  readonly rowVersion: string;
}

export interface ProjectSummaryViewModel {
  readonly id: string;
  readonly workspaceId?: string | null;
  readonly groupId?: string | null;
  readonly ownerUserId?: string | null;
  readonly name: string;
  readonly description?: string;
  readonly status: ProjectStatus;
  readonly statusLabel: string;
  readonly visibility?: ProjectVisibility;
  readonly visibilityLabel?: string;
  readonly activationState?: ProjectActivationState;
  readonly versionNo?: number;
  readonly isOperational?: boolean;
  readonly startDate: string;
  readonly dueDate: string;
  readonly updatedAt?: string;
  readonly group: string;
  readonly taskCounts: {
    readonly total: number;
    readonly done: number;
      readonly blocked: number;
  };
  readonly canCreateTask: boolean;
  readonly canActivate?: boolean;
}

export interface TaskRowAction {
  readonly id: TaskRowActionId;
  readonly label: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly mobileHidden?: boolean;
}

export interface TaskGridRow {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly project: string;
  readonly status: TaskStatus;
  readonly statusLabel: string;
  readonly workflowStageId?: string | null;
  readonly workflowStageName?: string;
  readonly stageCategory?: TaskStageCategory;
  readonly isBlocked?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly hasArtifact?: boolean;
  readonly rowVersion?: string;
  readonly priority: TaskPriority;
  readonly priorityLabel: string;
  readonly assignee: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly progressPercent: number | null;
  readonly milestone: string;
  readonly allowedTransitions: readonly TaskStatus[];
  readonly rowActions: readonly TaskRowAction[];
}

export type MyTasksTab = 'assigned' | 'participating' | 'reviews' | 'created' | 'watching' | 'teamQueue' | 'completed';
export type MyTasksScope = 'currentWorkspace' | 'allWorkspaces';
export type MyTasksUrgencyGroup = 'overdue' | 'today' | 'next7Days' | 'later' | 'noDeadline';
export type MyTasksStageCategoryFilter = '' | 'backlog' | 'todo' | 'inProgress' | 'review' | 'done' | 'cancelled';
export type MyTasksPriorityFilter = '' | 'low' | 'medium' | 'high' | 'critical';
export type MyTasksBlockedFilter = '' | 'true' | 'false';

export interface MyTasksFilters {
  readonly projectId: string;
  readonly stageCategory: MyTasksStageCategoryFilter;
  readonly priority: MyTasksPriorityFilter;
  readonly blocked: MyTasksBlockedFilter;
  readonly search: string;
  readonly timeGroup: MyTasksUrgencyGroup | null;
}

export interface MyTasksSavedFilterSnapshot extends MyTasksFilters {
  readonly selectedTab: MyTasksTab;
}

export interface MyTasksSavedFilter {
  readonly id: string;
  readonly name: string;
  readonly snapshot: MyTasksSavedFilterSnapshot;
}

export interface MyTasksFilterCondition {
  readonly id: string;
  readonly label: string;
}

export interface MyTasksLiveTask {
  readonly taskId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workspaceTitle: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly title: string;
  readonly workflowStageId: string | null;
  readonly workflowStageName: string;
  readonly stageCategory: TaskStageCategory;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly isBlocked: boolean;
  readonly plannedEndDate: string;
  readonly deadlineAt: string;
  readonly progressPercent: number;
  readonly timeGroup: MyTasksUrgencyGroup;
  readonly isOverdue: boolean;
  readonly version: string;
  readonly primaryAssignee: string;
  readonly targetGroup: string;
  readonly reviewer: string;
  readonly labels: readonly string[];
  readonly checklistCompletedCount: number;
  readonly checklistTotalCount: number;
  readonly canClaim: boolean;
  readonly canChangeStage: boolean;
  readonly warnings: readonly string[];
}

export interface MyTasksCount {
  readonly key: MyTasksTab | MyTasksUrgencyGroup;
  readonly count: number;
}

export interface ProjectsOverviewViewModel {
  readonly status: ProjectsPageStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly projects: readonly ProjectSummaryViewModel[];
  readonly rows: readonly TaskGridRow[];
  readonly columns: readonly AppDataGridColumnDef<TaskGridRow>[];
  readonly pageSize: {
    readonly defaultPageSize: number;
    readonly maximumPageSize: number;
  };
  readonly message?: string;
  readonly error?: FrontendApiError;
}

export interface MyTasksViewModel {
  readonly status: ProjectsPageStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly TaskGridRow[];
  readonly columns: readonly AppDataGridColumnDef<TaskGridRow>[];
  readonly pageSize: {
    readonly defaultPageSize: number;
    readonly maximumPageSize: number;
  };
  readonly message?: string;
  readonly error?: FrontendApiError;
  readonly tasks: readonly MyTasksLiveTask[];
  readonly selectedTab: MyTasksTab;
  readonly scope: MyTasksScope;
  readonly workspaceId: string | null;
  readonly workspaceOptions: readonly { readonly id: string; readonly label: string }[];
  readonly counts: readonly MyTasksCount[];
  readonly totalCount: number;
  readonly page: number;
  readonly selectedPageSize: number;
  readonly lastPage: number;
  readonly filters: MyTasksFilters;
  readonly projectFilterInputValue: string;
  readonly savedFilters: readonly MyTasksSavedFilter[];
  readonly savedFiltersAvailable: boolean;
  readonly canPersistSavedFilters: boolean;
  readonly filterConditions: readonly MyTasksFilterCondition[];
  readonly filterAnnouncement: string;
  readonly realtimeDegraded: boolean;
}

export interface TaskDetailViewModel {
  readonly status: ProjectsPageStatus;
  readonly detailState: TaskDetailState;
  readonly project?: ProjectSummaryViewModel;
  readonly task?: TaskGridRow;
  readonly editorTask?: TaskMockRecord;
  readonly dependencies: readonly TaskDependencyViewModel[];
  readonly capabilities: readonly ProjectCapability[];
  readonly transitionNote: BackendAuthoritativeTransitionNote;
  readonly detail?: TaskDetailAggregateViewModel;
  /** Aggregate transport state; task-row state alone must never mask its failure. */
  readonly detailSectionState: TaskDetailSectionState;
  readonly message?: string;
}

export interface TaskDetailAggregateViewModel {
  /** Bounded canonical Task fields retained separately from the legacy grid row. */
  readonly canonicalTask: TaskCanonicalDetailViewModel;
  /** The relationship aggregate is distinct from the Task's summary fields. */
  readonly relationships: TaskRelationshipsViewModel;
  readonly workspaceId: string | null;
  readonly permissions: TaskDetailPermissionsViewModel;
  readonly taskVersion: string;
  readonly checklist: readonly TaskChecklistViewModel[];
  readonly labels: readonly TaskLabelViewModel[];
  /** Project definitions are distinct from the labels already applied to this task. */
  readonly labelDefinitions: readonly TaskLabelViewModel[];
  readonly labelDefinitionsState: TaskDetailSectionState;
  readonly subtasks: TaskPageViewModel<TaskSubtaskViewModel>;
  readonly comments: TaskPageViewModel<TaskCommentViewModel>;
  readonly files: TaskPageViewModel<TaskFileAssociationViewModel>;
  readonly activity: TaskPageViewModel<TaskActivityLogViewModel>;
  readonly watchState: TaskWatchStateViewModel;
}

export interface TaskDetailPermissionsViewModel { readonly canCreateSubtask: boolean; readonly canCreateChecklistItem: boolean; readonly canUpdateChecklistItems: boolean; readonly canDeleteChecklistItems: boolean; readonly canReorderChecklist: boolean; readonly canCreateComment: boolean; readonly canMarkCommentImportant: boolean; readonly canApplyLabels: boolean; readonly canManageLabelDefinitions: boolean; readonly canAssociateFiles: boolean; readonly canRemoveFiles: boolean; readonly canChangeWatch: boolean; }
/** Mirrors ProjectTaskLabel validation in the backend TaskSubresourceService. */
export const TASK_LABEL_NAME_MAX_LENGTH = 120;
export const TASK_LABEL_DESCRIPTION_MAX_LENGTH = 1000;
export interface TaskPageViewModel<T> { readonly items: readonly T[]; readonly page: number; readonly pageSize: number; readonly totalCount: number; readonly hasMore: boolean; }
export interface TaskChecklistViewModel { readonly id: string; readonly text: string; readonly isCompleted: boolean; readonly completedAt: string | null; readonly completedByUserId: string | null; readonly sortKey: string; readonly version: string; }
export interface TaskLabelViewModel { readonly id: string; readonly name: string; readonly description: string | null; readonly sortKey: string; readonly isArchived: boolean; readonly version: string; }
export interface TaskSubtaskViewModel { readonly id: string; readonly parentTaskId: string; readonly title: string; readonly workflowStageId: string | null; readonly stage: string; readonly stageCategory: string; readonly priority: string; readonly progressPercent: number; readonly primaryAssignee: string | null; readonly plannedEndDate: string | null; readonly deadlineAt: string | null; readonly isOverdue: boolean; readonly version: string; }
export interface TaskCommentMentionViewModel { readonly userId: string; readonly displayName: string; }
export interface TaskCommentViewModel { readonly id: string; readonly taskId: string; readonly author: string | null; readonly body: string | null; readonly isImportant: boolean; readonly mentions: readonly TaskCommentMentionViewModel[]; readonly createdAt: string | null; readonly updatedAt: string | null; readonly deletedAt: string | null; readonly version: string; readonly canEdit: boolean; readonly canDelete: boolean; readonly canMarkImportant: boolean; }
/** id is the canonical Attachment ID for the Task association. */
export interface TaskFileAssociationViewModel { readonly id: string; readonly fileObjectId: string; readonly fileName: string; readonly contentType: string; readonly sizeBytes: number; readonly scanStatus: string; readonly createdAt: string | null; readonly accessState: string; readonly canOpen: boolean; readonly canRequestDownloadGrant: boolean; readonly downloadGrantRequired: boolean; readonly restrictionCode: string | null; }
export type TaskActivityLogType = 'note' | 'statusUpdate' | 'decision' | 'issue' | 'unknown';
export interface TaskActivityLogViewModel { readonly id: string; readonly activityType: TaskActivityLogType; readonly body: string; readonly occurredAt: string | null; readonly authorUserId: string | null; readonly authorDisplayName: string; }
export interface TaskWatchStateViewModel { readonly isWatching: boolean; readonly isExplicitOptOut: boolean; readonly automaticSources: readonly string[]; readonly version: string; }

export interface TaskEditorSaveRequest {
  readonly title: string;
  readonly description: string;
  readonly goal?: string;
  readonly deliverable?: string;
  readonly constraints?: string;
  readonly priority: TaskPriority;
  readonly startDate: string;
  readonly dueDate: string;
  readonly progressPercent: number;
  readonly expectedVersion: string;
}

export interface TaskCanonicalDetailViewModel {
  readonly id: string;
  readonly tenantId: string | null;
  readonly workspaceId: string | null;
  readonly projectId: string;
  readonly kind: string | number | null;
  readonly parentTaskId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly workflowStageId: string | null;
  readonly workflowStageName: string;
  readonly stageCategory: string | number | null;
  readonly priority: string;
  readonly plannedStartDate: string | null;
  readonly plannedEndDate: string | null;
  readonly deadlineAt: string | null;
  readonly progressPercent: number;
  readonly progressIsDerived: boolean;
  readonly reviewStatus: string | number | null;
  readonly version: string;
  readonly checklistCompletedCount: number;
  readonly checklistTotalCount: number;
  readonly commentCount: number;
  readonly labelCount: number;
  readonly subtaskCount: number;
}

export interface TaskRelationshipsViewModel {
  readonly primaryAssignee: string | null;
  readonly targetGroupId: string | null;
  readonly collaborators: readonly { readonly userId: string; readonly displayName: string }[];
  readonly reviewer: string | null;
  readonly version: string;
}

export interface CreateTaskFormRequest {
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly goal?: string;
  readonly deliverable?: string;
  readonly constraints?: string;
  readonly priority: TaskPriority;
  readonly startDate: string;
  readonly dueDate: string;
}

export const TASK_BRIEF_FIELD_MAX_LENGTH = 4000;
export type TaskBriefValueSource = 'notSet' | 'taskSpecific';
export interface TaskBriefFieldViewModel {
  readonly value: string | null;
  readonly source: TaskBriefValueSource;
}
export interface TaskBriefViewModel {
  readonly goal: TaskBriefFieldViewModel;
  readonly deliverable: TaskBriefFieldViewModel;
  readonly constraints: TaskBriefFieldViewModel;
}

export interface ProjectsScenario {
  readonly status: ProjectsPageStatus;
  readonly detailState?: TaskDetailState;
  /** Story-only editor state; this does not model an API response. */
  readonly taskMutationState?: TaskMutationState;
  /** Story-only UI state; it is not an API response. */
  readonly taskConflictReloadState?: TaskConflictReloadState;
  readonly title: string;
  readonly subtitle: string;
  readonly projects: readonly ProjectMockRecord[];
  readonly tasks: readonly TaskMockRecord[];
  readonly myTasks?: readonly TaskMockRecord[];
  readonly myTasksStatus?: ProjectsPageStatus;
  readonly myTasksMessage?: string;
  readonly myTasksError?: FrontendApiError;
  readonly currentUserAssignee: string;
  readonly mobile?: boolean;
  readonly message?: string;
  readonly error?: FrontendApiError;
}
