import { Component, computed, inject, signal } from '@angular/core';

import {
  AppDataGridActionEvent,
  AppDataGridColumnDef
} from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { AdminFacade } from '../admin.facade';
import { ExportJobDetailDrawerComponent } from '../export-job-detail-drawer/export-job-detail-drawer.component';
import { ExportJobGridRow, ExportDiagnosticsViewModel } from '../admin.types';
import { ExportRequestButtonComponent } from '../export-request-button/export-request-button.component';

@Component({
  selector: 'app-export-diagnostics-page',
  standalone: true,
  imports: [
    AppDataGridComponent,
    AppEmptyStateComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    ExportJobDetailDrawerComponent,
    ExportRequestButtonComponent
  ],
  templateUrl: './export-diagnostics-page.component.html',
  styleUrl: './export-diagnostics-page.component.scss'
})
export class ExportDiagnosticsPageComponent {
  private readonly facade = inject(AdminFacade);
  private readonly requestedJobs = signal<readonly ExportJobGridRow[]>([]);
  private readonly selectedJobId = signal<string | null | undefined>(undefined);
  readonly drawerReturnFocus = signal<HTMLElement | null>(null);

  readonly vm = computed(() => {
    const page = this.withColumns(this.facade.getExportDiagnostics());
    return {
      ...page,
      rows: [...this.requestedJobs(), ...page.rows]
    };
  });
  readonly selectedJob = computed(() => {
    const page = this.vm();
    const selectedJobId = this.selectedJobId();
    const selectedId = selectedJobId === undefined ? (page.initialSelectedJobId ?? null) : selectedJobId;
    return page.rows.find((row) => row.id === selectedId) ?? null;
  });

  handleGridAction(event: AppDataGridActionEvent<ExportJobGridRow>): void {
    if (event.actionId === 'openExportJobDetail') {
      this.drawerReturnFocus.set(event.trigger ?? null);
      this.selectedJobId.set(event.row.id);
    }
  }

  requestDiagnosticsExport(): void {
    const newJob = this.facade.requestDiagnosticsJob();
    this.requestedJobs.update((rows) => [newJob, ...rows]);
    this.drawerReturnFocus.set(null);
    this.selectedJobId.set(newJob.id);
  }

  closeDrawer(): void {
    this.selectedJobId.set(null);
    const target = this.drawerReturnFocus();
    queueMicrotask(() => target?.focus());
    this.drawerReturnFocus.set(null);
  }

  private withColumns(vm: ExportDiagnosticsViewModel): ExportDiagnosticsViewModel {
    return {
      ...vm,
      columns: this.columns
    };
  }

  private readonly columns: readonly AppDataGridColumnDef<ExportJobGridRow>[] = [
    { field: 'createdAt', headerName: 'createdAt', minWidth: 150, flex: 0.8, sortable: true },
    { field: 'jobType', headerName: 'jobType', minWidth: 180, flex: 1, sortable: true },
    {
      field: 'status',
      headerName: 'status',
      minWidth: 130,
      flex: 0.7,
      sortable: true,
      valueFormatter: (params) => params.data?.statusLabel ?? '',
      cellRenderer: (params: { data?: ExportJobGridRow }) => this.renderBadge(params.data?.statusLabel ?? '')
    },
    { field: 'requestedBy', headerName: 'requestedBy', minWidth: 160, flex: 0.9, sortable: true },
    { field: 'scope', headerName: 'scope', minWidth: 180, flex: 1, sortable: true, wrapText: true },
    {
      field: 'result',
      headerName: 'result',
      minWidth: 220,
      flex: 1.1,
      sortable: true,
      wrapText: true,
      autoHeight: true,
      valueFormatter: (params) => params.data?.resultLabel ?? '',
      cellRenderer: (params: { data?: ExportJobGridRow }) => this.renderDetailButton(params.data)
    },
    { field: 'requestId', headerName: 'requestId', minWidth: 160, flex: 0.9, sortable: true, wrapText: true }
  ];

  private renderBadge(label: string): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'admin-grid-badge';
    badge.textContent = label;
    return badge;
  }

  private renderDetailButton(row: ExportJobGridRow | undefined): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-grid-link';
    button.dataset['gridAction'] = 'openExportJobDetail';
    button.textContent = row?.resultLabel ?? 'Open detail';
    return button;
  }
}
