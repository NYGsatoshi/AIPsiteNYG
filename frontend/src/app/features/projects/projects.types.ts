import { AppDataGridColumnDef } from '../../shared/grid/app-data-grid/app-data-grid.types';

export const PROJECTS_DEFAULT_PAGE_SIZE = 50;
export const PROJECTS_MAXIMUM_PAGE_SIZE = 100;

export type ProjectsPageStatus = 'ready' | 'loading' | 'empty' | 'permissionDenied' | 'error';
export type ProjectStatus = 'planning' | 'active' | 'atRisk' | 'complete';
export type TaskStatus = 'notStarted' | 'inProgress' | 'blocked' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskRowActionId = 'openDetail' | 'edit' | 'assign' | 'changeStatus';
export type TaskDetailState = 'ready' | 'rowVersionConflict' | 'invalidStateTransition';
export type ProjectCapability = 'editTask' | 'assignTask' | 'changeTaskStatus' | 'editMilestone';

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
  readonly progressPercent: number;
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
  readonly progressPercent: number;
  readonly milestone: string;
  readonly allowedTransitions: readonly TaskStatus[];
  readonly rowActions: readonly TaskRowAction[];
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
  readonly message?: string;
}

export interface ProjectsScenario {
  readonly status: ProjectsPageStatus;
  readonly detailState?: TaskDetailState;
  readonly title: string;
  readonly subtitle: string;
  readonly projects: readonly ProjectMockRecord[];
  readonly tasks: readonly TaskMockRecord[];
  readonly currentUserAssignee: string;
  readonly mobile?: boolean;
  readonly message?: string;
}
