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
import { AuditDetailDrawerComponent } from '../audit-detail-drawer/audit-detail-drawer.component';
import { AuditGridRow, AuditLogViewModel } from '../admin.types';

@Component({
  selector: 'app-audit-log-page',
  standalone: true,
  imports: [
    AppDataGridComponent,
    AppEmptyStateComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    AuditDetailDrawerComponent
  ],
  templateUrl: './audit-log-page.component.html',
  styleUrl: './audit-log-page.component.scss'
})
export class AuditLogPageComponent {
  private readonly facade = inject(AdminFacade);
  private readonly selectedAuditId = signal<string | null | undefined>(undefined);
  readonly drawerReturnFocus = signal<HTMLElement | null>(null);

  readonly vm = computed(() => this.withColumns(this.facade.getAuditLog()));
  readonly selectedAudit = computed(() => {
    const page = this.vm();
    const selectedAuditId = this.selectedAuditId();
    const selectedId = selectedAuditId === undefined ? (page.initialSelectedAuditId ?? null) : selectedAuditId;
    return page.rows.find((row) => row.id === selectedId) ?? null;
  });

  handleGridAction(event: AppDataGridActionEvent<AuditGridRow>): void {
    if (event.actionId === 'openAuditDetail') {
      this.drawerReturnFocus.set(event.trigger ?? null);
      this.selectedAuditId.set(event.row.id);
    }
  }

  closeDrawer(): void {
    this.selectedAuditId.set(null);
    const target = this.drawerReturnFocus();
    queueMicrotask(() => target?.focus());
    this.drawerReturnFocus.set(null);
  }

  private withColumns(vm: AuditLogViewModel): AuditLogViewModel {
    return {
      ...vm,
      columns: this.columns
    };
  }

  private readonly columns: readonly AppDataGridColumnDef<AuditGridRow>[] = [
    { field: 'createdAt', headerName: 'createdAt', minWidth: 150, flex: 0.8, sortable: true },
    { field: 'action', headerName: 'action', minWidth: 190, flex: 1.1, sortable: true, wrapText: true, autoHeight: true },
    { field: 'actorDisplay', headerName: 'actorDisplay', minWidth: 160, flex: 0.9, sortable: true },
    { field: 'targetType', headerName: 'targetType', minWidth: 140, flex: 0.8, sortable: true },
    { field: 'workspace', headerName: 'workspace', minWidth: 180, flex: 1, sortable: true, wrapText: true },
    {
      field: 'severity',
      headerName: 'severity',
      minWidth: 120,
      flex: 0.7,
      sortable: true,
      valueFormatter: (params) => params.data?.severityLabel ?? '',
      cellRenderer: (params: { data?: AuditGridRow }) => this.renderBadge(params.data?.severityLabel ?? '')
    },
    {
      field: 'result',
      headerName: 'result',
      minWidth: 120,
      flex: 0.7,
      sortable: true,
      valueFormatter: (params) => params.data?.resultLabel ?? '',
      cellRenderer: (params: { data?: AuditGridRow }) => this.renderBadge(params.data?.resultLabel ?? '')
    },
    {
      field: 'summary',
      headerName: 'summary',
      minWidth: 260,
      flex: 1.5,
      sortable: false,
      wrapText: true,
      autoHeight: true,
      cellRenderer: (params: { data?: AuditGridRow }) => this.renderDetailButton(params.data)
    },
    { field: 'requestId', headerName: 'requestId', minWidth: 160, flex: 0.9, sortable: true, wrapText: true }
  ];

  private renderBadge(label: string): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'admin-grid-badge';
    badge.textContent = label;
    return badge;
  }

  private renderDetailButton(row: AuditGridRow | undefined): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-grid-link';
    button.dataset['gridAction'] = 'openAuditDetail';
    button.textContent = row?.summary ?? 'Open detail';
    return button;
  }
}
