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
export type AipAdapterState = 'ready' | 'loading' | 'empty' | 'error' | 'permission-denied' | 'conflict' | 'degraded';

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
  readonly itemDescription?: (item: TItem) => string;
  /** Command proposals are enabled only when the backend exposes permission. */
  readonly canRequestTransition: (item: TItem, targetStatus: string) => boolean;
}

export interface AipKanbanColumn {
  readonly id: string;
  readonly label: string;
}

export interface AipKanbanTransitionRequest<TItem> {
  readonly item: TItem;
  readonly targetStatus: string;
  readonly source: 'drag' | 'keyboard';
}

export interface AipGanttContract<TTask> extends AipAdapterShellContract {
  readonly tasks: readonly TTask[];
  readonly taskIdentity: (task: TTask) => string;
  readonly taskLabel: (task: TTask) => string;
  readonly milestones: readonly AipGanttMilestone[];
  readonly timezone: string;
  readonly readOnly: boolean;
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
