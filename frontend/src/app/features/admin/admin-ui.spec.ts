import { Component, EventEmitter, Input, Output } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  AppDataGridActionEvent,
  AppDataGridColumnDef,
  clampAppDataGridPageSize
} from '../../shared/grid/app-data-grid/app-data-grid.types';
import { AppDataGridComponent } from '../../shared/grid/app-data-grid/app-data-grid.component';
import { routes } from '../../app.routes';
import { DEFAULT_NAVIGATION_ITEMS } from '../../layout/app-shell/app-shell.facade';
import { AdminFacade, AIP_ADMIN_AUDIT_MOCK, AIP_EXPORT_DIAGNOSTICS_MOCK } from './admin.facade';
import {
  AUDIT_LOG_SCENARIOS,
  AUDIT_RAW_METADATA_PROBE,
  EXPORT_DIAGNOSTICS_SCENARIOS
} from './admin.mock';
import { AuditGridRow, ExportJobGridRow } from './admin.types';
import { AuditLogPageComponent } from './audit-log-page/audit-log-page.component';
import { ExportDiagnosticsPageComponent } from './export-diagnostics-page/export-diagnostics-page.component';

@Component({
  selector: 'app-data-grid',
  standalone: true,
  template: `
    <section data-testid="app-data-grid">
      <p data-testid="stub-page-size">{{ defaultPageSize }}/{{ maximumPageSize }}</p>
      @for (column of columns; track column.headerName) {
        <span data-testid="grid-column">{{ column.field }}</span>
      }
      @for (row of rows; track row.id) {
        <article data-testid="audit-row">
          @for (column of columns; track column.headerName) {
            <span [attr.data-testid]="'audit-cell-' + column.field">{{ valueFor(row, column.field) }}</span>
          }
          <button type="button" data-testid="open-audit-detail" (click)="open(row)">Open detail</button>
        </article>
      }
    </section>
  `
})
class StubAuditDataGridComponent {
  @Input() rows: readonly AuditGridRow[] = [];
  @Input() columns: readonly AppDataGridColumnDef<AuditGridRow>[] = [];
  @Input() defaultPageSize = 0;
  @Input() maximumPageSize = 0;
  @Input() rowIdField = 'id';
  @Input() ariaLabel = '';
  @Output() actionInvoked = new EventEmitter<AppDataGridActionEvent<AuditGridRow>>();

  valueFor(row: AuditGridRow, field: (keyof AuditGridRow & string) | undefined): unknown {
    return field ? row[field] : '';
  }

  open(row: AuditGridRow): void {
    this.actionInvoked.emit({ actionId: 'openAuditDetail', row });
  }
}

@Component({
  selector: 'app-data-grid',
  standalone: true,
  template: `
    <section data-testid="app-data-grid">
      <p data-testid="stub-page-size">{{ defaultPageSize }}/{{ maximumPageSize }}</p>
      @for (column of columns; track column.headerName) {
        <span data-testid="grid-column">{{ column.field }}</span>
      }
      @for (row of rows; track row.id) {
        <article data-testid="export-row">
          @for (column of columns; track column.headerName) {
            <span [attr.data-testid]="'export-cell-' + column.field">{{ valueFor(row, column.field) }}</span>
          }
          <button type="button" data-testid="open-export-detail" (click)="open(row)">Open detail</button>
        </article>
      }
    </section>
  `
})
class StubExportDataGridComponent {
  @Input() rows: readonly ExportJobGridRow[] = [];
  @Input() columns: readonly AppDataGridColumnDef<ExportJobGridRow>[] = [];
  @Input() defaultPageSize = 0;
  @Input() maximumPageSize = 0;
  @Input() rowIdField = 'id';
  @Input() ariaLabel = '';
  @Output() actionInvoked = new EventEmitter<AppDataGridActionEvent<ExportJobGridRow>>();

  valueFor(row: ExportJobGridRow, field: (keyof ExportJobGridRow & string) | undefined): unknown {
    return field ? row[field] : '';
  }

  open(row: ExportJobGridRow): void {
    this.actionInvoked.emit({ actionId: 'openExportJobDetail', row });
  }
}

const angularCmpKey = '\u0275cmp';

const dependencyNames = (component: unknown): string[] => {
  const cmp = (component as Record<string, { dependencies?: unknown[] }>)[angularCmpKey];
  const dependencies = (cmp?.dependencies ?? []) as Array<{ name?: string; type?: { name?: string } }>;
  return dependencies.map((dependency) => dependency.type?.name ?? dependency.name ?? '');
};

const textContent = <T>(fixture: ComponentFixture<T>): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

const query = <T extends HTMLElement, C = unknown>(fixture: ComponentFixture<C>, selector: string): T | null =>
  (fixture.nativeElement as HTMLElement).querySelector<T>(selector);

const queryAll = <T extends HTMLElement, C = unknown>(fixture: ComponentFixture<C>, selector: string): T[] =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<T>(selector));

const renderAudit = async (
  scenario: (typeof AUDIT_LOG_SCENARIOS)[keyof typeof AUDIT_LOG_SCENARIOS] = AUDIT_LOG_SCENARIOS.default
) => {
  await TestBed.configureTestingModule({
    imports: [AuditLogPageComponent],
    providers: [{ provide: AIP_ADMIN_AUDIT_MOCK, useValue: scenario }]
  })
    .overrideComponent(AuditLogPageComponent, {
      remove: { imports: [AppDataGridComponent] },
      add: { imports: [StubAuditDataGridComponent] }
    })
    .compileComponents();

  const fixture = TestBed.createComponent(AuditLogPageComponent);
  fixture.detectChanges();
  return fixture;
};

const renderExport = async (
  scenario: (typeof EXPORT_DIAGNOSTICS_SCENARIOS)[keyof typeof EXPORT_DIAGNOSTICS_SCENARIOS] =
    EXPORT_DIAGNOSTICS_SCENARIOS.default
) => {
  await TestBed.configureTestingModule({
    imports: [ExportDiagnosticsPageComponent],
    providers: [
      { provide: AIP_ADMIN_AUDIT_MOCK, useValue: AUDIT_LOG_SCENARIOS.empty },
      { provide: AIP_EXPORT_DIAGNOSTICS_MOCK, useValue: scenario }
    ]
  }).compileComponents();

  const fixture = TestBed.createComponent(ExportDiagnosticsPageComponent);
  fixture.detectChanges();
  return fixture;
};

describe('Admin audit and export mock UI', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('registers target admin routes', () => {
    const appRoute = routes.find((route) => route.path === '' && route.children);
    const childPaths = appRoute?.children?.map((route) => route.path) ?? [];

    expect(childPaths).toContain('admin/audit');
    expect(childPaths).toContain('admin/export-diagnostics');
  });

  it('does not include export diagnostics in MVP0 navigation', () => {
    expect(DEFAULT_NAVIGATION_ITEMS.map((item) => item.route)).not.toContain('/admin/export-diagnostics');
  });

  it('audit route page does not directly use AgGridAngular and does use the shared wrapper', () => {
    const auditDependencies = dependencyNames(AuditLogPageComponent);

    expect(auditDependencies).not.toContain('AgGridAngular');
    expect(auditDependencies.some((name) => name.includes('AppDataGridComponent'))).toBe(true);
  });

  it('keeps ag-grid-enterprise absent from admin component dependencies', () => {
    const enterprisePackageName = 'ag-grid' + '-enterprise';
    const adminDependencies = [...dependencyNames(AuditLogPageComponent), ...dependencyNames(ExportDiagnosticsPageComponent)].join(' ');

    expect(adminDependencies).not.toContain(enterprisePackageName);
  });

  it('renders required audit grid columns without raw metadata JSON', async () => {
    const fixture = await renderAudit();
    const columnFields = queryAll(fixture, '[data-testid="grid-column"]').map((element) => element.textContent?.trim());

    expect(columnFields).toEqual([
      'createdAt',
      'action',
      'actorDisplay',
      'targetType',
      'workspace',
      'severity',
      'result',
      'summary',
      'requestId'
    ]);
    expect(textContent(fixture)).not.toContain(AUDIT_RAW_METADATA_PROBE);
    expect(textContent(fixture)).not.toContain('restricted body must stay hidden');
    expect(textContent(fixture)).not.toContain('tenant/private/key');
  });

  it('redacted audit detail drawer does not show restricted fields', async () => {
    const fixture = await renderAudit(AUDIT_LOG_SCENARIOS.redactedDetailDrawer);
    const text = textContent(fixture);

    expect(query(fixture, '[data-testid="audit-detail-drawer"]')).not.toBeNull();
    expect(text).toContain('Suppressed');
    expect(text).toContain('Redacted');
    expect(text).not.toContain('restricted body must stay hidden');
    expect(text).not.toContain('tenant/private/key');
    expect(text).not.toContain('select hidden');
  });

  it('severity and result are typed fields in the view model', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: AIP_ADMIN_AUDIT_MOCK, useValue: AUDIT_LOG_SCENARIOS.default }]
    });
    const facade = TestBed.inject(AdminFacade);
    const page = facade.getAuditLog();

    expect(page.rows[0].severity).toBe('info');
    expect(page.rows[1].result).toBe('denied');
    expect(page.typedFieldNote.metadataParsing).toBe('prohibited');
  });

  it('maps live audit grid result and severity from backend typed fields', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    const facade = TestBed.inject(AdminFacade);
    const httpMock = TestBed.inject(HttpTestingController);

    httpMock.expectOne('/api/admin/audit-grid').flush({
      items: [
        {
          id: 'audit-live-success',
          createdAt: '2026-07-02T09:14:00Z',
          action: 'workspace.member.view',
          actorDisplayName: 'Live Admin',
          targetType: 'WorkspaceMember',
          workspaceLabel: 'Live Workspace',
          severity: 'info',
          result: 'success',
          summary: 'Member list opened.',
          requestId: 'req-live-success'
        },
        {
          id: 'audit-live-denied',
          createdAt: '2026-07-02T09:22:00Z',
          action: 'file.download.denied',
          actorDisplayName: 'Live Teacher',
          targetType: 'File',
          workspaceLabel: 'Live Workspace',
          severity: 'warning',
          result: 'denied',
          summary: 'Download blocked.',
          requestId: 'req-live-denied'
        },
        {
          id: 'audit-live-failed',
          createdAt: '2026-07-02T09:35:00Z',
          action: 'export.request.failed',
          actorDisplayName: 'Live Operator',
          targetType: 'ExportJob',
          workspaceLabel: null,
          severity: 'critical',
          result: 'failed',
          summary: 'Export failed.',
          requestId: null
        }
      ]
    });

    const rows = facade.getAuditLog().rows;

    expect(rows.map((row) => row.result)).toEqual(['success', 'denied', 'failed']);
    expect(rows.map((row) => row.severity)).toEqual(['info', 'warning', 'critical']);
    expect(rows[2].workspace).toBe('');
    httpMock.verify();
  });

  it('shows export diagnostics as unavailable without a request button or local rows', async () => {
    const fixture = await renderExport(EXPORT_DIAGNOSTICS_SCENARIOS.notAllowed);

    expect(query(fixture, '[data-testid="export-request-action"]')).toBeNull();
    expect(query(fixture, '[data-testid="export-request-disabled"]')).toBeNull();
    expect(query(fixture, '[data-testid="app-data-grid"]')).toBeNull();
    expect(queryAll(fixture, '[data-testid="export-row"]').length).toBe(0);
    expect(textContent(fixture)).toContain('Not available in MVP0');
    expect(textContent(fixture)).not.toContain('req-export');
  });

  it('does not expose Excel export API or visible-grid export actions', async () => {
    const audit = await renderAudit();
    TestBed.resetTestingModule();
    const exportDiagnostics = await renderExport();
    const combinedText = `${textContent(audit)} ${textContent(exportDiagnostics)}`;

    expect(combinedText).not.toContain('exportDataAsExcel');
    expect(combinedText).not.toContain('Excel');
    expect(combinedText).not.toContain('Download visible grid');
  });

  it('uses bounded page size with maximum 100', async () => {
    const fixture = await renderAudit(AUDIT_LOG_SCENARIOS.manyRowsBoundedPage);

    expect(query(fixture, '[data-testid="stub-page-size"]')?.textContent).toContain('50/100');
    expect(clampAppDataGridPageSize(250, 500)).toBe(100);
  });

  it('renders requestId as text without creating markup', async () => {
    const fixture = await renderAudit();

    expect(textContent(fixture)).toContain('req-safe-<audit-003>');
    expect(query(fixture, 'script')).toBeNull();
  });

  it('mobile layout does not expose hidden admin actions', async () => {
    const fixture = await renderExport(EXPORT_DIAGNOSTICS_SCENARIOS.notAllowed);

    (fixture.nativeElement as HTMLElement).style.width = '320px';
    fixture.detectChanges();

    expect(query(fixture, '[data-testid="export-request-action"]')).toBeNull();
  });
});
