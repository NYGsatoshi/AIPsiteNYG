import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AllCommunityModule,
  CellClickedEvent,
  ColDef,
  GridOptions,
  Module,
  ModuleRegistry
} from 'ag-grid-community';

import {
  APP_DATA_GRID_DEFAULT_PAGE_SIZE,
  APP_DATA_GRID_MAXIMUM_PAGE_SIZE,
  AppDataGridActionEvent,
  AppDataGridColumnDef,
  clampAppDataGridPageSize
} from './app-data-grid.types';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-data-grid',
  standalone: true,
  imports: [AgGridAngular],
  templateUrl: './app-data-grid.component.html',
  styleUrl: './app-data-grid.component.scss'
})
export class AppDataGridComponent<TData extends object> {
  @Input() rows: readonly TData[] = [];
  @Input() columns: readonly AppDataGridColumnDef<TData>[] = [];
  @Input() loading = false;
  @Input() defaultPageSize = APP_DATA_GRID_DEFAULT_PAGE_SIZE;
  @Input() maximumPageSize = APP_DATA_GRID_MAXIMUM_PAGE_SIZE;
  @Input() rowIdField: keyof TData & string = 'id' as keyof TData & string;
  @Input() ariaLabel = 'データグリッド';
  @Output() actionInvoked = new EventEmitter<AppDataGridActionEvent<TData>>();

  readonly modules: Module[] = [AllCommunityModule];
  readonly defaultColDef: ColDef<TData> = {
    resizable: true,
    sortable: true,
    filter: false,
    suppressHeaderMenuButton: true,
    wrapHeaderText: true,
    autoHeaderHeight: true
  };
  readonly gridOptions: GridOptions<TData> = {
    rowModelType: 'clientSide',
    domLayout: 'autoHeight',
    suppressContextMenu: true,
    suppressCellFocus: false,
    enableCellTextSelection: true,
    ensureDomOrder: true,
    suppressCsvExport: true
  };

  get columnDefs(): ColDef<TData>[] {
    return [...this.columns] as unknown as ColDef<TData>[];
  }

  get rowData(): TData[] {
    return [...this.rows];
  }

  get boundedPageSize(): number {
    return clampAppDataGridPageSize(this.defaultPageSize, this.maximumPageSize);
  }

  get pageSizeOptions(): number[] {
    return [this.boundedPageSize, this.maximumPageSize]
      .map((size) => clampAppDataGridPageSize(size, this.maximumPageSize))
      .filter((size, index, sizes) => sizes.indexOf(size) === index);
  }

  get maximumPageSizeLabel(): string {
    return String(Math.min(this.maximumPageSize, APP_DATA_GRID_MAXIMUM_PAGE_SIZE));
  }

  getRowId = (params: { data: TData }): string => String(params.data[this.rowIdField]);

  handleCellClicked(event: CellClickedEvent<TData>): void {
    const target = event.event?.target;
    if (!(target instanceof HTMLElement) || !event.data) {
      return;
    }

    const actionTarget = target.closest<HTMLElement>('[data-grid-action]');
    const actionId = actionTarget?.dataset['gridAction'];
    if (!actionId || actionTarget?.getAttribute('aria-disabled') === 'true') {
      return;
    }

    this.actionInvoked.emit({ actionId, row: event.data });
  }
}
