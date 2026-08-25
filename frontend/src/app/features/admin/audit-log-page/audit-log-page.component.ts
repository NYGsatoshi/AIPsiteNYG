import { DOCUMENT } from '@angular/common';
import { afterNextRender, Component, computed, effect, inject, Injector, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import {
  AppDataGridActionEvent,
  AppDataGridColumnDef,
  AppDataGridRowActivationEvent,
} from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { AdminFacade } from '../admin.facade';
import { AuditDetailDrawerComponent } from '../audit-detail-drawer/audit-detail-drawer.component';
import { AuditGridRow, AuditLogViewModel } from '../admin.types';

type AuditGridOptionalColumn = 'workspace' | 'requestId';
type AuditGridDensity = 'default' | 'dense';

interface DrawerScrollPosition {
  readonly host: HTMLElement;
  readonly left: number;
  readonly top: number;
}

interface DrawerReturnContext {
  readonly auditId: string;
  readonly target: HTMLElement;
  readonly positions: readonly DrawerScrollPosition[];
}

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
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly routeEventId = this.route
    ? toSignal(
        this.route.queryParamMap.pipe(
          map((params) => params.get('event')),
          distinctUntilChanged(),
        ),
        { initialValue: this.route.snapshot.queryParamMap.get('event') },
      )
    : signal<string | null>(null);
  private routeSelectionInitialized = false;
  private readonly selectedAuditId = signal<string | null>(null);
  private readonly visibleOptionalColumns = signal<ReadonlySet<AuditGridOptionalColumn>>(new Set());
  // This is retained across a Back -> Forward round trip for the same event.
  // That lets an explicit Close after Forward return to the original row while
  // still refusing to focus an element that was virtualized away.
  private readonly drawerReturnContext = signal<DrawerReturnContext | null>(null);
  readonly density = signal<AuditGridDensity>('default');
  readonly optionalColumns = [
    { id: 'workspace' as const, label: 'Workspace' },
    { id: 'requestId' as const, label: 'Request ID' },
  ];

  readonly vm = computed(() => this.withColumns(this.facade.getAuditLog()));
  readonly auditDetail = computed(() => this.facade.getAuditDetail());
  readonly selectedAudit = computed(() => this.auditDetail().row);
  readonly drawerOpen = computed(() => this.selectedAuditId() !== null);

  constructor() {
    effect(() => {
      const eventId = this.routeEventId();
      untracked(() => this.syncSelectionFromRoute(eventId));
    });
  }

  handleGridAction(event: AppDataGridActionEvent<AuditGridRow>): void {
    if (event.actionId === 'openAuditDetail') {
      this.openAuditDetail(event.row.id, event.trigger ?? null);
    }
  }

  handleGridRowActivation(event: AppDataGridRowActivationEvent<AuditGridRow>): void {
    this.openAuditDetail(event.row.id, event.trigger ?? null);
  }

  openMobileDetail(row: AuditGridRow, trigger: HTMLElement): void {
    this.openAuditDetail(row.id, trigger);
  }

  retry(): void {
    this.facade.reloadAuditLog();
  }

  closeDrawer(): void {
    const hadSelection = this.selectedAuditId() !== null;
    this.selectedAuditId.set(null);
    this.facade.clearAuditDetail();
    if (hadSelection) {
      this.restoreDrawerFocus();
    }
    void this.updateRouteSelection(null, true);
  }

  isColumnVisible(column: AuditGridOptionalColumn): boolean {
    return this.visibleOptionalColumns().has(column);
  }

  toggleColumn(column: AuditGridOptionalColumn, visible: boolean): void {
    this.visibleOptionalColumns.update((current) => {
      const next = new Set(current);
      if (visible) {
        next.add(column);
      } else {
        next.delete(column);
      }
      return next;
    });
  }

  setDensity(density: AuditGridDensity): void {
    this.density.set(density);
  }

  private withColumns(vm: AuditLogViewModel): AuditLogViewModel {
    return {
      ...vm,
      columns: this.columns
    };
  }

  private get columns(): readonly AppDataGridColumnDef<AuditGridRow>[] {
    const visible = this.visibleOptionalColumns();
    const columns: AppDataGridColumnDef<AuditGridRow>[] = [
    { field: 'createdAt', headerName: 'createdAt', minWidth: 150, flex: 0.8, sortable: true },
    { field: 'action', headerName: 'action', minWidth: 190, flex: 1.1, sortable: true, wrapText: true, autoHeight: true },
    { field: 'actorDisplay', headerName: 'actorDisplay', minWidth: 160, flex: 0.9, sortable: true },
    { field: 'targetType', headerName: 'targetType', minWidth: 140, flex: 0.8, sortable: true },
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
      actions: (row) => [{ id: 'openAuditDetail', label: row.summary, row }],
      cellRenderer: (params: { data?: AuditGridRow }) => this.renderDetailButton(params.data)
    },
    ];

    if (visible.has('workspace')) {
      columns.splice(4, 0, { field: 'workspace', headerName: 'workspace', minWidth: 180, flex: 1, sortable: true, wrapText: true });
    }
    if (visible.has('requestId')) {
      columns.push({ field: 'requestId', headerName: 'requestId', minWidth: 160, flex: 0.9, sortable: true, wrapText: true });
    }

    return columns;
  }

  private openAuditDetail(auditId: string, trigger: HTMLElement | null): void {
    if (trigger) {
      this.drawerReturnContext.set({
        auditId,
        target: trigger,
        positions: this.captureScrollPositions(trigger),
      });
    } else if (this.drawerReturnContext()?.auditId !== auditId) {
      this.drawerReturnContext.set(null);
    }
    this.selectedAuditId.set(auditId);
    this.facade.selectAuditDetail(auditId);
    void this.updateRouteSelection(auditId, false);
  }

  private syncSelectionFromRoute(auditId: string | null): void {
    if (!this.routeSelectionInitialized) {
      this.routeSelectionInitialized = true;
      if (auditId) {
        this.selectedAuditId.set(auditId);
        this.facade.selectAuditDetail(auditId);
      }
      return;
    }

    const previousAuditId = this.selectedAuditId();
    this.selectedAuditId.set(auditId);
    if (auditId) {
      if (this.drawerReturnContext()?.auditId !== auditId) {
        this.drawerReturnContext.set(null);
      }
      this.facade.selectAuditDetail(auditId);
      return;
    }

    this.facade.clearAuditDetail();
    if (previousAuditId) {
      this.restoreDrawerFocus({ preserveForHistory: true });
    }
  }

  private async updateRouteSelection(auditId: string | null, replaceUrl: boolean): Promise<void> {
    if (!this.router || !this.route) {
      return;
    }

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { event: auditId },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  private restoreDrawerFocus({ preserveForHistory = false }: { preserveForHistory?: boolean } = {}): void {
    const context = this.drawerReturnContext();
    if (!preserveForHistory) {
      this.drawerReturnContext.set(null);
    }
    // The drawer is conditionally removed by the same state change. Restore
    // only after that render so a direct deep link or disconnected virtual row
    // has a stable in-page fallback instead of retaining focus on Close.
    afterNextRender(
      {
        write: () => {
          this.restoreScrollPositions(context?.positions ?? []);
          queueMicrotask(() => this.finishDrawerFocusRestore(context, preserveForHistory));
        },
      },
      { injector: this.injector },
    );
  }

  private captureScrollPositions(trigger: HTMLElement): readonly DrawerScrollPosition[] {
    const positions: DrawerScrollPosition[] = [];
    const seen = new Set<HTMLElement>();
    const remember = (host: HTMLElement | null): void => {
      if (!host || seen.has(host) || !this.isScrollable(host)) {
        return;
      }

      seen.add(host);
      positions.push({ host, left: host.scrollLeft, top: host.scrollTop });
    };

    for (let current = trigger.parentElement; current; current = current.parentElement) {
      remember(current);
    }
    remember(this.document.getElementById('app-shell-main-content'));
    remember(this.document.scrollingElement instanceof HTMLElement ? this.document.scrollingElement : null);

    return positions;
  }

  private restoreScrollPositions(positions: readonly DrawerScrollPosition[]): void {
    // Restore outer surfaces first, then the grid's own viewport. This keeps a
    // virtualized row in the same visual context before we validate its ID.
    for (const position of [...positions].reverse()) {
      if (!position.host.isConnected || typeof position.host.scrollTo !== 'function') {
        continue;
      }

      try {
        position.host.scrollTo({ left: position.left, top: position.top, behavior: 'auto' });
      } catch {
        // JSDOM and embedded webviews may expose a non-implemented scrollTo.
        // Focus restoration remains valid without a programmatic scroll.
      }
    }
  }

  private isScrollable(host: HTMLElement): boolean {
    return host.scrollHeight > host.clientHeight + 1 || host.scrollWidth > host.clientWidth + 1;
  }

  private finishDrawerFocusRestore(
    context: DrawerReturnContext | null,
    preserveForHistory: boolean,
  ): void {
    const target = context ? this.resolveReturnFocusTarget(context) : null;
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }

    if (preserveForHistory && context && this.drawerReturnContext() === context) {
      this.drawerReturnContext.set(null);
    }
    this.focusDrawerFallback();
  }

  private resolveReturnFocusTarget(context: DrawerReturnContext): HTMLElement | null {
    if (this.isFocusableReturnTarget(context.target) && this.isReturnTargetForAudit(context.target, context.auditId)) {
      return context.target;
    }

    return Array.from(
      this.document.querySelectorAll<HTMLElement>(
        '[data-testid="audit-log-page"] button[data-grid-row-id], ' +
        '[data-testid="audit-log-page"] [tabindex][data-grid-row-id]',
      ),
    ).find((candidate) =>
      candidate.dataset['gridRowId'] === context.auditId &&
      this.isFocusableReturnTarget(candidate) &&
      this.isReturnTargetForAudit(candidate, context.auditId),
    ) ?? null;
  }

  private isFocusableReturnTarget(target: HTMLElement): boolean {
    if (target.matches(':disabled, [aria-disabled="true"]')) {
      return false;
    }

    // AG and Syncfusion grid cells are programmatic focus targets even when
    // they use tabindex="-1". Do not select arbitrary rendered text nodes:
    // calling focus on those would silently leave focus on the removed drawer.
    return target.matches('button, [href], input, select, textarea, [tabindex], .ag-cell, .e-rowcell');
  }

  private isReturnTargetForAudit(target: HTMLElement, auditId: string): boolean {
    if (!target.isConnected) {
      return false;
    }

    const agRow = target.closest<HTMLElement>('.ag-row');
    if (agRow) {
      return agRow.getAttribute('row-id') === auditId;
    }

    const syncfusionRow = target.closest<HTMLElement>('.e-row');
    if (syncfusionRow) {
      return Array.from(syncfusionRow.querySelectorAll<HTMLElement>('[data-grid-row-id]'))
        .some((element) => element.dataset['gridRowId'] === auditId);
    }

    return target.closest<HTMLElement>('[data-grid-row-id]')?.dataset['gridRowId'] === auditId;
  }

  private focusDrawerFallback(): void {
    this.document
      .querySelector<HTMLElement>('[data-testid="audit-log-title"]')
      ?.focus({ preventScroll: true });
  }

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
    if (row) {
      button.dataset['gridRowId'] = row.id;
    }
    button.textContent = row?.summary ?? 'Open detail';
    return button;
  }
}
