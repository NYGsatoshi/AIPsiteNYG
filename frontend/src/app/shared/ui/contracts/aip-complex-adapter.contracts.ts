export type AipComplexAdapterName =
  | 'data-grid'
  | 'dialog'
  | 'file-uploader'
  | 'date-time-picker'
  | 'kanban'
  | 'gantt'
  | 'tree-grid'
  | 'scheduler';

export type AipAdapterPresentation = 'desktop' | 'narrow';
export type AipAdapterState = 'ready' | 'loading' | 'empty' | 'error' | 'permission-denied' | 'conflict' | 'degraded' | 'rollback';

export interface AipAdapterShellContract {
  readonly ariaLabel: string;
  readonly presentation: AipAdapterPresentation;
  readonly state: AipAdapterState;
}

export interface AipDataGridColumn<TRow> {
  readonly id: string;
  readonly label: string;
  readonly value: (row: TRow) => string;
}

export interface AipDataGridContract<TRow> extends AipAdapterShellContract {
  readonly rows: readonly TRow[];
  readonly columns: readonly AipDataGridColumn<TRow>[];
  readonly rowIdentity: (row: TRow) => string;
  readonly page: number;
  readonly pageSize: number;
}

export interface AipDialogContract extends AipAdapterShellContract {
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly closeOnEscape: boolean;
  readonly destructive: boolean;
  readonly busy?: boolean;
}

export interface AipFileUploadItem {
  readonly clientRequestId: string;
  readonly fileName: string;
  readonly state: 'pending' | 'uploading' | 'succeeded' | 'failed' | 'cancelled';
}

export interface AipFileUploaderContract extends AipAdapterShellContract {
  readonly files: readonly AipFileUploadItem[];
  readonly multiple: boolean;
  /** Client policy is intentionally absent: the backend owns file validation. */
  readonly disabled?: boolean;
}

export interface AipDateTimePickerContract extends AipAdapterShellContract {
  readonly value: string | null;
  readonly timezone: string;
  readonly readOnly: boolean;
}

export interface AipKanbanContract<TItem> extends AipAdapterShellContract {
  readonly items: readonly TItem[];
  readonly itemIdentity: (item: TItem) => string;
  readonly columns: readonly AipKanbanColumn[];
  readonly itemTitle: (item: TItem) => string;
  readonly itemStatus: (item: TItem) => string;
  readonly itemOrder: (item: TItem) => number;
  readonly itemDescription?: (item: TItem) => string;
  readonly itemMetadata?: (item: TItem) => readonly string[];
  readonly itemKindLabel?: (item: TItem) => string;
  /** Optional presentation grouping; it never rewrites item ownership or state. */
  readonly itemSwimlane?: (item: TItem) => { readonly key: string; readonly label: string };
  readonly canOpenItem: (item: TItem) => boolean;
  readonly canMoveItem: (item: TItem) => boolean;
  /** Command proposals are enabled only when the backend exposes permission. */
  readonly canRequestTransition: (item: TItem, targetStatus: string) => boolean;
  readonly busyItemId?: string | null;
  readonly focusItemId?: string | null;
  readonly feedback?: string | null;
}

export interface AipKanbanColumn {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly cardCount: number;
  readonly wipWarningLimit: number | null;
  readonly hasWipWarning: boolean;
  readonly requiresReason?: boolean;
}

export interface AipKanbanMoveRequest<TItem> {
  readonly item: TItem;
  readonly targetStatus: string;
  /** A null before/after pair is the canonical end-of-Stage intent. */
  readonly targetBeforeItemId: string | null;
  readonly targetAfterItemId: string | null;
  readonly reason: string | null;
  readonly source: 'drag' | 'keyboard';
}

/** Calendar dates are ISO `yyyy-MM-dd` values and are never browser-local timestamps. */
export type AipGanttDateOnly = string;
export type AipGanttItemKind = 'task' | 'milestone';
export type AipGanttStageCategory = 'backlog' | 'todo' | 'inProgress' | 'review' | 'done' | 'cancelled';
export type AipGanttPriority = 'low' | 'medium' | 'high' | 'critical';
export type AipGanttDependencyType = 'finishToStart' | 'startToStart' | 'finishToFinish' | 'startToFinish';
export type AipGanttWarningSeverity = 'info' | 'warning';
export type AipGanttEditSource = 'pointer' | 'keyboard' | 'form';

export interface AipGanttWarning {
  readonly code: string;
  readonly message: string;
  readonly severity: AipGanttWarningSeverity;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly field: string | null;
  /** Gantt projection warnings are informational; blocking failures use the API error contract. */
  readonly blocking: false;
}

export interface AipGanttPermissions {
  readonly canEditSchedule: boolean;
  readonly canEditProgress: boolean;
  readonly canManageDependencies: boolean;
  readonly canClearSchedule: boolean;
  readonly canOpen: boolean;
}

export interface AipGanttAssignee {
  readonly userId: string;
  readonly displayName: string;
}

export interface AipGanttCalendar {
  readonly timeZone: string;
  readonly workingDays: readonly string[];
  readonly holidaysAvailable: boolean;
  readonly limitations: readonly string[];
}

export interface AipGanttItem {
  readonly taskId: string;
  readonly kind: AipGanttItemKind;
  readonly parentTaskId: string | null;
  readonly milestoneId: string | null;
  readonly title: string;
  readonly plannedStartDate: AipGanttDateOnly | null;
  readonly plannedEndDate: AipGanttDateOnly | null;
  readonly milestoneDate: AipGanttDateOnly | null;
  readonly progressPercent: number;
  readonly progressIsDerived: boolean;
  readonly workflowStageId: string | null;
  readonly workflowStageName: string | null;
  readonly stageCategory: AipGanttStageCategory;
  readonly priority: AipGanttPriority;
  readonly isBlocked: boolean;
  readonly primaryAssignee: AipGanttAssignee | null;
  readonly version: number;
  readonly scheduleEditPermissions: AipGanttPermissions;
  readonly warnings: readonly AipGanttWarning[];
}

export interface AipGanttDependency {
  readonly dependencyId: string;
  readonly predecessorTaskId: string;
  readonly successorTaskId: string;
  readonly type: AipGanttDependencyType;
  readonly editable: boolean;
  readonly version: number;
  readonly warnings: readonly AipGanttWarning[];
}

export interface AipGanttScheduleEditIntent {
  readonly kind: 'schedule';
  readonly taskId: string;
  readonly plannedStartDate: AipGanttDateOnly | null;
  readonly plannedEndDate: AipGanttDateOnly | null;
  readonly milestoneDate: AipGanttDateOnly | null;
  readonly expectedVersion: number;
  readonly source: AipGanttEditSource;
}

export interface AipGanttProgressEditIntent {
  readonly kind: 'progress';
  readonly taskId: string;
  readonly progressPercent: number;
  readonly expectedVersion: number;
  readonly source: AipGanttEditSource;
}

export interface AipGanttAddDependencyEditIntent {
  readonly kind: 'addDependency';
  readonly predecessorTaskId: string;
  readonly successorTaskId: string;
  readonly type: 'finishToStart';
  readonly expectedVersion: number;
  readonly source: AipGanttEditSource;
}

export interface AipGanttRemoveDependencyEditIntent {
  readonly kind: 'removeDependency';
  readonly dependencyId: string;
  readonly successorTaskId: string;
  readonly expectedVersion: number;
  readonly source: AipGanttEditSource;
}

export type AipGanttEditIntent =
  | AipGanttScheduleEditIntent
  | AipGanttProgressEditIntent
  | AipGanttAddDependencyEditIntent
  | AipGanttRemoveDependencyEditIntent;

export interface AipGanttEditResult {
  readonly item: AipGanttItem | null;
  readonly dependency: AipGanttDependency | null;
  readonly removedDependencyId: string | null;
  readonly version: number;
  readonly warnings: readonly AipGanttWarning[];
}

export interface AipGanttContract<TTask = AipGanttItem> extends AipAdapterShellContract {
  /**
   * Compatibility projection used until the existing read-only Schedule tab is
   * switched to the canonical collections below.
   */
  readonly tasks: readonly TTask[];
  readonly taskIdentity: (task: TTask) => string;
  readonly taskLabel: (task: TTask) => string;
  readonly milestones: readonly AipGanttMilestone[];
  readonly timezone: string;
  readonly readOnly: boolean;
  readonly calendar?: AipGanttCalendar;
  readonly scheduledItems?: readonly AipGanttItem[];
  readonly unscheduledItems?: readonly AipGanttItem[];
  readonly canonicalMilestones?: readonly AipGanttItem[];
  readonly dependencies?: readonly AipGanttDependency[];
  readonly warnings?: readonly AipGanttWarning[];
  readonly permissions?: AipGanttPermissions;
  readonly busyItemId?: string | null;
  readonly focusItemId?: string | null;
  readonly feedback?: string | null;
  readonly requestEdit?: (intent: AipGanttEditIntent) => void;
}

export interface AipGanttMilestone {
  readonly id: string;
  readonly title: string;
  readonly dueDate: string | null;
  readonly status: string;
}

export interface AipTreeGridContract<TItem> extends AipAdapterShellContract {
  readonly items: readonly TItem[];
  readonly itemIdentity: (item: TItem) => string;
}

export interface AipSchedulerContract<TItem> extends AipAdapterShellContract {
  readonly items: readonly TItem[];
  readonly timezone: string;
}
