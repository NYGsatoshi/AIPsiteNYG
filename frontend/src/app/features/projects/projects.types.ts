import { AppDataGridColumnDef } from '../../shared/grid/app-data-grid/app-data-grid.types';
import { FrontendApiError } from '../../core/api/api-error.model';

export const PROJECTS_DEFAULT_PAGE_SIZE = 50;
export const PROJECTS_MAXIMUM_PAGE_SIZE = 100;

export type ProjectsPageStatus = 'ready' | 'loading' | 'empty' | 'permissionDenied' | 'error';
export type ProjectStatus = 'planning' | 'active' | 'review' | 'atRisk' | 'complete' | 'suspended' | 'archived';
export type TaskStatus = 'notStarted' | 'inProgress' | 'blocked' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskRowActionId = 'openDetail' | 'edit' | 'assign' | 'changeStatus';
export type TaskDetailState = 'ready' | 'rowVersionConflict' | 'invalidStateTransition';
export type ProjectCapability = 'editTask' | 'assignTask' | 'changeTaskStatus' | 'editMilestone';

export type TaskMutationState =
  | { readonly status: 'idle' }
  | { readonly status: 'submitting' }
  | { readonly status: 'success' }
  | { readonly status: 'failure'; readonly message: string; readonly requestId?: string }
  | { readonly status: 'conflict'; readonly message: string; readonly serverVersion?: unknown };

/** State is deliberately scoped: an unrelated Task section must never disable another one. */
export type TaskDetailSection = 'detail' | 'subtasks' | 'checklist' | 'comments' | 'labels' | 'watch' | 'files';
export type TaskDetailSectionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'submitting' | 'success' | 'error' | 'permissionDenied' | 'conflict';
export interface TaskDetailSectionState {
  readonly status: TaskDetailSectionStatus;
  readonly message?: string;
  readonly requestId?: string;
  readonly retryable?: boolean;
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
  readonly name: string;
  readonly status: ProjectStatus;
  readonly statusLabel: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly group: string;
  readonly authorized: boolean;
  readonly canCreateTask: boolean;
}

export interface TaskMockRecord {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly statusLabel: string;
  readonly priority: TaskPriority;
  readonly priorityLabel: string;
  readonly assignee: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly progressPercent: number | null;
  readonly milestone: string;
  readonly dependencyIds: readonly string[];
  readonly allowedTransitions: readonly TaskStatus[];
  readonly capabilities: readonly ProjectCapability[];
  readonly authorized: boolean;
  readonly rowVersion: string;
}

export interface ProjectSummaryViewModel {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly statusLabel: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly group: string;
  readonly taskCounts: {
    readonly total: number;
    readonly done: number;
      readonly blocked: number;
  };
  readonly canCreateTask: boolean;
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
  readonly counts: readonly MyTasksCount[];
  readonly totalCount: number;
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
  readonly message?: string;
}

export interface TaskDetailAggregateViewModel {
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
  readonly watchState: TaskWatchStateViewModel;
}

export interface TaskDetailPermissionsViewModel { readonly canCreateSubtask: boolean; readonly canCreateChecklistItem: boolean; readonly canUpdateChecklistItems: boolean; readonly canDeleteChecklistItems: boolean; readonly canReorderChecklist: boolean; readonly canCreateComment: boolean; readonly canMarkCommentImportant: boolean; readonly canApplyLabels: boolean; readonly canManageLabelDefinitions: boolean; readonly canAssociateFiles: boolean; readonly canRemoveFiles: boolean; readonly canChangeWatch: boolean; }
export interface TaskPageViewModel<T> { readonly items: readonly T[]; readonly page: number; readonly pageSize: number; readonly totalCount: number; readonly hasMore: boolean; }
export interface TaskChecklistViewModel { readonly id: string; readonly text: string; readonly isCompleted: boolean; readonly completedAt: string | null; readonly completedByUserId: string | null; readonly sortKey: string; readonly version: string; }
export interface TaskLabelViewModel { readonly id: string; readonly name: string; readonly description: string | null; readonly sortKey: string; readonly isArchived: boolean; readonly version: string; }
export interface TaskSubtaskViewModel { readonly id: string; readonly parentTaskId: string; readonly title: string; readonly workflowStageId: string | null; readonly stage: string; readonly stageCategory: string; readonly priority: string; readonly progressPercent: number; readonly primaryAssignee: string | null; readonly plannedEndDate: string | null; readonly deadlineAt: string | null; readonly isOverdue: boolean; readonly version: string; }
export interface TaskCommentMentionViewModel { readonly userId: string; readonly displayName: string; }
export interface TaskCommentViewModel { readonly id: string; readonly taskId: string; readonly author: string | null; readonly body: string | null; readonly isImportant: boolean; readonly mentions: readonly TaskCommentMentionViewModel[]; readonly createdAt: string | null; readonly updatedAt: string | null; readonly deletedAt: string | null; readonly version: string; readonly canEdit: boolean; readonly canDelete: boolean; readonly canMarkImportant: boolean; }
/** id is the canonical Attachment ID for the Task association. */
export interface TaskFileAssociationViewModel { readonly id: string; readonly fileObjectId: string; readonly fileName: string; readonly contentType: string; readonly sizeBytes: number; readonly scanStatus: string; readonly createdAt: string | null; readonly accessState: string; readonly canOpen: boolean; readonly canRequestDownloadGrant: boolean; readonly downloadGrantRequired: boolean; readonly restrictionCode: string | null; }
export interface TaskWatchStateViewModel { readonly isWatching: boolean; readonly isExplicitOptOut: boolean; readonly automaticSources: readonly string[]; readonly version: string; }

export interface TaskEditorSaveRequest {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly startDate: string;
  readonly dueDate: string;
  readonly progressPercent: number;
  readonly status?: TaskStatus;
}

export interface CreateTaskFormRequest {
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly startDate: string;
  readonly dueDate: string;
}

export interface ProjectsScenario {
  readonly status: ProjectsPageStatus;
  readonly detailState?: TaskDetailState;
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
