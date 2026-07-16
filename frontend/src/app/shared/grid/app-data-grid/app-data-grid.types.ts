export const APP_DATA_GRID_DEFAULT_PAGE_SIZE = 50;
export const APP_DATA_GRID_MAXIMUM_PAGE_SIZE = 100;

export interface AppDataGridActionEvent<TData> {
  readonly actionId: string;
  readonly row: TData;
  readonly trigger?: HTMLElement;
}

/**
 * AIPsite-owned input supplied to column formatters and value readers.  This
 * deliberately has no vendor event or row-node shape: adapters map it to
 * their own callback model at the boundary.
 */
export interface AppDataGridCellValueContext<TData> {
  readonly data?: TData;
  readonly value?: unknown;
}

export interface AppDataGridColumnDef<TData> {
  readonly colId?: string;
  readonly field?: keyof TData & string;
  readonly headerName: string;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly flex?: number;
  readonly sortable?: boolean;
  readonly filter?: boolean | 'text';
  readonly wrapText?: boolean;
  readonly autoHeight?: boolean;
  readonly cellClass?: string | string[];
  readonly valueGetter?: (params: AppDataGridCellValueContext<TData>) => unknown;
  readonly valueFormatter?: (params: AppDataGridCellValueContext<TData>) => string;
  /** Adapter-owned renderer token or callback. Feature code never imports a vendor renderer type. */
  readonly cellRenderer?: unknown;
}

export const clampAppDataGridPageSize = (
  requestedPageSize: number,
  maximumPageSize = APP_DATA_GRID_MAXIMUM_PAGE_SIZE
): number => {
  const boundedMaximum = Math.max(1, Math.min(maximumPageSize, APP_DATA_GRID_MAXIMUM_PAGE_SIZE));
  return Math.max(1, Math.min(requestedPageSize, boundedMaximum));
};
