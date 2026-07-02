import { Type } from '@angular/core';
import { ColDef, ValueFormatterParams, ValueGetterParams } from 'ag-grid-community';

export const APP_DATA_GRID_DEFAULT_PAGE_SIZE = 50;
export const APP_DATA_GRID_MAXIMUM_PAGE_SIZE = 100;

export interface AppDataGridActionEvent<TData> {
  readonly actionId: string;
  readonly row: TData;
}

export interface AppDataGridColumnDef<TData> {
  readonly colId?: string;
  readonly field?: keyof TData & string;
  readonly headerName: string;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly flex?: number;
  readonly sortable?: boolean;
  readonly filter?: boolean | 'agTextColumnFilter';
  readonly wrapText?: boolean;
  readonly autoHeight?: boolean;
  readonly cellClass?: string | string[];
  readonly valueGetter?: (params: ValueGetterParams<TData>) => unknown;
  readonly valueFormatter?: (params: ValueFormatterParams<TData>) => string;
  readonly cellRenderer?: Type<unknown> | ColDef<TData>['cellRenderer'];
}

export const clampAppDataGridPageSize = (
  requestedPageSize: number,
  maximumPageSize = APP_DATA_GRID_MAXIMUM_PAGE_SIZE
): number => {
  const boundedMaximum = Math.max(1, Math.min(maximumPageSize, APP_DATA_GRID_MAXIMUM_PAGE_SIZE));
  return Math.max(1, Math.min(requestedPageSize, boundedMaximum));
};
