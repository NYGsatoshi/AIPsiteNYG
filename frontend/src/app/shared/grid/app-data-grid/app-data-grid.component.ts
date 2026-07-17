import {
  AfterViewInit,
  Component,
  ComponentRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  ViewContainerRef,
  inject,
  signal
} from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AllCommunityModule,
  CellClickedEvent,
  ColDef,
  GridOptions,
  Module,
  ModuleRegistry
} from 'ag-grid-community';

import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';
import {
  APP_DATA_GRID_DEFAULT_PAGE_SIZE,
  APP_DATA_GRID_MAXIMUM_PAGE_SIZE,
  AppDataGridActionEvent,
  AppDataGridColumnDef,
  AppDataGridFilterChange,
  AppDataGridMigrationTarget,
  AppDataGridPageChange,
  AppDataGridSelectionChange,
  AppDataGridSelectionMode,
  AppDataGridSortChange,
  clampAppDataGridPageSize
} from './app-data-grid.types';
import type { SyncfusionDataGridComponent } from '../../ui/adapters/syncfusion/syncfusion-data-grid.component';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-data-grid',
  standalone: true,
  imports: [AgGridAngular],
  templateUrl: './app-data-grid.component.html',
  styleUrl: './app-data-grid.component.scss'
})
export class AppDataGridComponent<TData extends object> implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  private readonly flags = inject(FrontendFeatureFlagsService);
  @ViewChild('syncfusionHost', { read: ViewContainerRef }) private syncfusionHost?: ViewContainerRef;

  @Input() rows: readonly TData[] = [];
  @Input() columns: readonly AppDataGridColumnDef<TData>[] = [];
  @Input() loading = false;
  @Input() defaultPageSize = APP_DATA_GRID_DEFAULT_PAGE_SIZE;
  @Input() maximumPageSize = APP_DATA_GRID_MAXIMUM_PAGE_SIZE;
  @Input() rowIdField: keyof TData & string = 'id' as keyof TData & string;
  @Input() ariaLabel = 'Data grid';
  /** Target-limited internal migration switch; feature code remains vendor-neutral. */
  @Input() migrationTarget?: AppDataGridMigrationTarget;
  @Input() selectionMode: AppDataGridSelectionMode = 'none';
  @Input() page = 1;
  @Input() error: string | null = null;
  @Input() emptyState: string | null = null;
  @Input() permissionDenied = false;
  @Output() actionInvoked = new EventEmitter<AppDataGridActionEvent<TData>>();
  @Output() rowActivated = new EventEmitter<TData>();
  @Output() selectionChanged = new EventEmitter<AppDataGridSelectionChange<TData>>();
  @Output() pageChanged = new EventEmitter<AppDataGridPageChange>();
  @Output() sortChanged = new EventEmitter<AppDataGridSortChange>();
  @Output() filterChanged = new EventEmitter<AppDataGridFilterChange>();

  readonly syncfusionRequested = signal(false);
  readonly syncfusionLoadError = signal<string | null>(null);
  private syncfusionComponent?: ComponentRef<SyncfusionDataGridComponent<TData>>;
  private viewReady = false;

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
    theme: 'legacy',
    rowModelType: 'clientSide',
    domLayout: 'autoHeight',
    suppressContextMenu: true,
    suppressCellFocus: false,
    enableCellTextSelection: true,
    ensureDomOrder: true,
    suppressCsvExport: true
  };

  get columnDefs(): ColDef<TData>[] {
    return this.columns.map((column) => ({
      ...column,
      valueGetter: column.valueGetter
        ? (params) => column.valueGetter?.({ data: params.data })
        : undefined,
      valueFormatter: column.valueFormatter
        ? (params) => column.valueFormatter?.({ data: params.data, value: params.value })
        : undefined
    })) as unknown as ColDef<TData>[];
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

  ngOnInit(): void {
    this.syncfusionRequested.set(
      this.migrationTarget !== undefined && this.flags.syncfusionGridEnabled()
    );
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.syncfusionRequested()) {
      void this.loadSyncfusionAdapter();
    }
  }

  ngOnChanges(_: SimpleChanges): void {
    this.updateSyncfusionInputs();
  }

  ngOnDestroy(): void {
    this.syncfusionComponent?.destroy();
  }

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

    this.actionInvoked.emit({ actionId, row: event.data, trigger: actionTarget });
  }

  private async loadSyncfusionAdapter(): Promise<void> {
    if (!this.viewReady || this.syncfusionComponent || !this.syncfusionHost) {
      return;
    }

    try {
      const { SyncfusionDataGridComponent } = await import('../../ui/adapters/syncfusion/syncfusion-data-grid.component');
      if (!this.syncfusionHost) {
        return;
      }

      const component = this.syncfusionHost.createComponent(SyncfusionDataGridComponent) as unknown as ComponentRef<SyncfusionDataGridComponent<TData>>;
      this.syncfusionComponent = component;
      this.syncfusionComponent.instance.actionInvoked.subscribe((event) => this.actionInvoked.emit(event));
      this.syncfusionComponent.instance.rowActivated.subscribe((row) => this.rowActivated.emit(row));
      this.syncfusionComponent.instance.selectionChanged.subscribe((event) => this.selectionChanged.emit(event));
      this.syncfusionComponent.instance.pageChanged.subscribe((event) => this.pageChanged.emit(event));
      this.syncfusionComponent.instance.sortChanged.subscribe((event) => this.sortChanged.emit(event));
      this.syncfusionComponent.instance.filterChanged.subscribe((event) => this.filterChanged.emit(event));
      this.updateSyncfusionInputs();
    } catch {
      // A flagged vendor adapter must never silently become the AG Grid fallback.
      this.syncfusionLoadError.set('The data grid could not be loaded. Disable the rollout flag to use the retained fallback.');
    }
  }

  private updateSyncfusionInputs(): void {
    const component = this.syncfusionComponent;
    if (!component) {
      return;
    }

    component.setInput('rows', this.rows);
    component.setInput('columns', this.columns);
    component.setInput('loading', this.loading);
    component.setInput('defaultPageSize', this.defaultPageSize);
    component.setInput('maximumPageSize', this.maximumPageSize);
    component.setInput('rowIdField', this.rowIdField);
    component.setInput('ariaLabel', this.ariaLabel);
    component.setInput('selectionMode', this.selectionMode);
    component.setInput('page', this.page);
    component.setInput('error', this.error);
    component.setInput('emptyState', this.emptyState);
    component.setInput('permissionDenied', this.permissionDenied);
  }
}
