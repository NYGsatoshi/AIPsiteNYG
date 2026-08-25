import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import {
  FilterService,
  GridComponent,
  GridModule,
  PageService,
  SelectionService,
  SortService
} from '@syncfusion/ej2-angular-grids';

import {
  APP_DATA_GRID_DEFAULT_PAGE_SIZE,
  APP_DATA_GRID_MAXIMUM_PAGE_SIZE,
  AppDataGridActionEvent,
  AppDataGridColumnDef,
  AppDataGridFilterChange,
  AppDataGridPageChange,
  AppDataGridRowActivationEvent,
  AppDataGridSelectionChange,
  AppDataGridSelectionMode,
  AppDataGridSortChange,
  clampAppDataGridPageSize
} from '../../../grid/app-data-grid/app-data-grid.types';

type SyncfusionGridEvent<TData> = {
  readonly rowData?: TData;
  readonly data?: TData | readonly TData[];
  readonly target?: EventTarget | null;
  readonly event?: Event;
  readonly requestType?: string;
  readonly columnName?: string;
  readonly direction?: string;
  readonly currentPage?: number;
  readonly currentFilterObject?: { readonly field?: string; readonly value?: unknown };
};

@Component({
  selector: 'app-syncfusion-data-grid',
  standalone: true,
  imports: [GridModule],
  providers: [PageService, SortService, FilterService, SelectionService],
  templateUrl: './syncfusion-data-grid.component.html',
  styleUrl: './syncfusion-data-grid.component.scss'
})
export class SyncfusionDataGridComponent<TData extends object> {
  @ViewChild('grid') private grid?: GridComponent;

  @Input() rows: readonly TData[] = [];
  @Input() columns: readonly AppDataGridColumnDef<TData>[] = [];
  @Input() loading = false;
  @Input() defaultPageSize = APP_DATA_GRID_DEFAULT_PAGE_SIZE;
  @Input() maximumPageSize = APP_DATA_GRID_MAXIMUM_PAGE_SIZE;
  @Input() rowIdField: keyof TData & string = 'id' as keyof TData & string;
  @Input() ariaLabel = 'Data grid';
  @Input() selectionMode: AppDataGridSelectionMode = 'none';
  @Input() rowHeight?: number;
  @Input() stickyHeader = false;
  @Input() page = 1;
  @Input() error: string | null = null;
  @Input() emptyState: string | null = null;
  @Input() permissionDenied = false;
  @Output() actionInvoked = new EventEmitter<AppDataGridActionEvent<TData>>();
  @Output() rowActivated = new EventEmitter<AppDataGridRowActivationEvent<TData>>();
  @Output() selectionChanged = new EventEmitter<AppDataGridSelectionChange<TData>>();
  @Output() pageChanged = new EventEmitter<AppDataGridPageChange>();
  @Output() sortChanged = new EventEmitter<AppDataGridSortChange>();
  @Output() filterChanged = new EventEmitter<AppDataGridFilterChange>();

  get boundedPageSize(): number {
    return clampAppDataGridPageSize(this.defaultPageSize, this.maximumPageSize);
  }

  get pageSizeOptions(): number[] {
    return [this.boundedPageSize, this.maximumPageSize]
      .map((size) => clampAppDataGridPageSize(size, this.maximumPageSize))
      .filter((size, index, values) => values.indexOf(size) === index);
  }

  get pageSettings(): { currentPage: number; pageSize: number; pageSizes: readonly number[] } {
    return { currentPage: Math.max(1, this.page), pageSize: this.boundedPageSize, pageSizes: this.pageSizeOptions };
  }

  get selectionSettings(): { type: 'Single' | 'Multiple'; mode: 'Row'; checkboxOnly: boolean } {
    return { type: this.selectionMode === 'multiple' ? 'Multiple' : 'Single', mode: 'Row', checkboxOnly: true };
  }

  get filteringEnabled(): boolean {
    return this.columns.some((column) => column.filter === true || column.filter === 'text');
  }

  getColumnId(column: AppDataGridColumnDef<TData>): string {
    return column.colId ?? column.field ?? column.headerName;
  }

  getColumnField(column: AppDataGridColumnDef<TData>): string {
    return column.field ?? this.getColumnId(column);
  }

  getRowIdValue(row: TData): string {
    const value = row[this.rowIdField];
    return value === null || value === undefined ? '' : String(value);
  }

  getCellClass(column: AppDataGridColumnDef<TData>): string {
    return Array.isArray(column.cellClass) ? column.cellClass.join(' ') : column.cellClass ?? '';
  }

  displayValue(column: AppDataGridColumnDef<TData>, row: TData): string {
    const value = column.valueGetter
      ? column.valueGetter({ data: row })
      : column.field
        ? row[column.field]
        : '';

    return column.valueFormatter
      ? column.valueFormatter({ data: row, value })
      : value === null || value === undefined ? '' : String(value);
  }

  hasActions(column: AppDataGridColumnDef<TData>): boolean {
    return typeof column.actions === 'function';
  }

  invokeAction(actionId: string, row: TData, event: Event): void {
    event.stopPropagation();
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    this.actionInvoked.emit({ actionId, row, trigger });
  }

  handleRecordClick(event: SyncfusionGridEvent<TData>): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('[data-grid-action]') || target?.closest('.e-checkselect')) {
      return;
    }

    const row = (event.rowData ?? event.data) as TData | undefined;
    if (row) {
      this.rowActivated.emit({
        row,
        trigger: target?.closest<HTMLElement>('.e-rowcell') ?? target ?? undefined,
      });
    }
  }

  handleSelectionChanged(): void {
    if (this.selectionMode === 'none') {
      return;
    }

    const rows = (this.grid?.getSelectedRecords() ?? []) as TData[];
    this.selectionChanged.emit({ rows });
  }

  handleActionComplete(event: SyncfusionGridEvent<TData>): void {
    if (event.requestType === 'paging') {
      this.pageChanged.emit({ page: event.currentPage ?? this.page, pageSize: this.boundedPageSize });
      return;
    }

    if (event.requestType === 'sorting' && event.columnName) {
      this.sortChanged.emit({
        columnId: event.columnName,
        direction: event.direction === 'Ascending' ? 'ascending' : event.direction === 'Descending' ? 'descending' : null
      });
      return;
    }

    if (event.requestType === 'filtering') {
      const filter = event.currentFilterObject;
      this.filterChanged.emit({
        columnId: filter?.field ?? event.columnName ?? '',
        value: filter?.value === undefined || filter?.value === null ? null : String(filter.value)
      });
    }
  }
}
