import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_MAXIMUM_PAGE_SIZE,
  AUDIT_TYPED_FIELD_NOTE,
  AdminPageStatus,
  AuditGridRow,
  AuditLogScenario,
  AuditLogViewModel,
  AuditMockRecord,
  AuditResult,
  AuditSeverity,
  EXPORT_AUTHORIZATION_NOTE,
  ExportDiagnosticsScenario,
  ExportDiagnosticsViewModel,
  ExportJobGridRow,
  ExportJobMockRecord,
  ExportJobResult,
  ExportJobStatus,
} from './admin.types';

export const AIP_ADMIN_AUDIT_MOCK = new InjectionToken<AuditLogScenario>('AIP_ADMIN_AUDIT_MOCK');
export const AIP_EXPORT_DIAGNOSTICS_MOCK = new InjectionToken<ExportDiagnosticsScenario>(
  'AIP_EXPORT_DIAGNOSTICS_MOCK',
);

const severityLabels: Record<AuditSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

const resultLabels: Record<AuditResult, string> = {
  success: 'Success',
  denied: 'Denied',
  failed: 'Failed',
};

const statusLabels: Record<ExportJobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

const exportResultLabels: Record<ExportJobResult, string> = {
  notReady: 'Not ready',
  available: 'Available after server check',
  failed: 'Failed',
  suppressed: 'Suppressed',
};

interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

interface AuditLogDto {
  readonly id: string;
  readonly createdAt: string;
  readonly action: string;
  readonly actorDisplayName: string;
  readonly targetType: string;
  readonly workspaceLabel?: string | null;
  readonly severity: AuditSeverity;
  readonly result: AuditResult;
  readonly summary: string;
  readonly requestId?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class AdminFacade {
  private readonly http = inject(HttpClient);
  private readonly auditScenario = inject(AIP_ADMIN_AUDIT_MOCK, { optional: true });
  private readonly exportScenario = inject(AIP_EXPORT_DIAGNOSTICS_MOCK, { optional: true });
  private readonly auditState = signal<AuditLogViewModel>(
    this.auditScenario ? this.auditFromScenario(this.auditScenario) : this.emptyAudit('loading'),
  );
  private readonly exportState = signal<ExportDiagnosticsViewModel>(
    this.exportScenario
      ? this.exportFromScenario(this.exportScenario)
      : this.emptyExportDiagnostics(),
  );

  constructor() {
    if (!this.auditScenario) {
      this.loadAuditLog();
    }
  }

  getAuditLog(): AuditLogViewModel {
    return this.auditState();
  }

  reloadAuditLog(): void {
    if (!this.auditScenario) {
      this.loadAuditLog();
    }
  }

  getExportDiagnostics(): ExportDiagnosticsViewModel {
    return this.exportState();
  }

  private loadAuditLog(): void {
    this.http
      .get<PagedResponseDto<AuditLogDto>>('/api/admin/audit-grid', { withCredentials: true })
      .subscribe({
        next: (response) => {
          const rows = (response.items ?? []).map((record) =>
            this.toAuditGridRow(this.toAuditRecord(record)),
          );
          this.auditState.set({
            ...this.emptyAudit(rows.length === 0 ? 'empty' : 'ready'),
            rows,
            message: rows.length === 0 ? 'No audit records were returned by the API.' : undefined,
          });
        },
        error: (error: { status?: number }) => {
          this.auditState.set({
            ...this.emptyAudit(
              error.status === 401 || error.status === 403 ? 'permissionDenied' : 'error',
            ),
            message:
              error.status === 401 || error.status === 403
                ? 'Authentication or audit permission is required.'
                : 'Audit log API request failed.',
          });
        },
      });
  }

  private auditFromScenario(scenario: AuditLogScenario): AuditLogViewModel {
    return {
      status: scenario.status,
      title: scenario.title,
      subtitle: scenario.subtitle,
      rows: scenario.auditRecords.map((record) => this.toAuditGridRow(record)),
      columns: [],
      pageSize: {
        defaultPageSize: ADMIN_DEFAULT_PAGE_SIZE,
        maximumPageSize: ADMIN_MAXIMUM_PAGE_SIZE,
      },
      typedFieldNote: AUDIT_TYPED_FIELD_NOTE,
      initialSelectedAuditId: scenario.initialSelectedAuditId,
      message: scenario.message,
    };
  }

  private exportFromScenario(scenario: ExportDiagnosticsScenario): ExportDiagnosticsViewModel {
    return {
      status: scenario.status,
      title: scenario.title,
      subtitle: scenario.subtitle,
      rows: scenario.exportJobs.map((job) => this.toExportJobGridRow(job)),
      columns: [],
      pageSize: {
        defaultPageSize: ADMIN_DEFAULT_PAGE_SIZE,
        maximumPageSize: ADMIN_MAXIMUM_PAGE_SIZE,
      },
      canRequestDiagnosticsExport: scenario.canRequestDiagnosticsExport,
      authorizationNote: EXPORT_AUTHORIZATION_NOTE,
      initialSelectedJobId: scenario.initialSelectedJobId,
      message: scenario.message,
    };
  }

  private emptyAudit(status: AdminPageStatus): AuditLogViewModel {
    return {
      status,
      title: 'Audit log',
      subtitle: 'Live API data',
      rows: [],
      columns: [],
      pageSize: {
        defaultPageSize: ADMIN_DEFAULT_PAGE_SIZE,
        maximumPageSize: ADMIN_MAXIMUM_PAGE_SIZE,
      },
      typedFieldNote: AUDIT_TYPED_FIELD_NOTE,
    };
  }

  private emptyExportDiagnostics(): ExportDiagnosticsViewModel {
    return {
      status: 'empty',
      title: 'Export diagnostics not available in MVP0',
      subtitle: 'Disabled for MVP0',
      rows: [],
      columns: [],
      pageSize: {
        defaultPageSize: ADMIN_DEFAULT_PAGE_SIZE,
        maximumPageSize: ADMIN_MAXIMUM_PAGE_SIZE,
      },
      canRequestDiagnosticsExport: false,
      authorizationNote: EXPORT_AUTHORIZATION_NOTE,
      message: 'Export diagnostics are not implemented for MVP0. Requests, job history, and downloads are disabled.',
    };
  }

  private toAuditGridRow(record: AuditMockRecord): AuditGridRow {
    return {
      id: record.id,
      createdAt: record.createdAt,
      action: record.action,
      actorDisplay: record.actorDisplay,
      targetType: record.targetType,
      workspace: record.workspace,
      severity: record.severity,
      severityLabel: severityLabels[record.severity],
      result: record.result,
      resultLabel: resultLabels[record.result],
      summary: record.summary,
      requestId: record.requestId,
      redactedDetails: record.redactedDetails,
    };
  }

  private toExportJobGridRow(job: ExportJobMockRecord): ExportJobGridRow {
    return {
      id: job.id,
      createdAt: job.createdAt,
      jobType: job.jobType,
      status: job.status,
      statusLabel: statusLabels[job.status],
      requestedBy: job.requestedBy,
      scope: job.scope,
      result: job.result,
      resultLabel: exportResultLabels[job.result],
      requestId: job.requestId,
      redactedDetails: job.redactedDetails,
    };
  }

  private toAuditRecord(record: AuditLogDto): AuditMockRecord {
    return {
      id: record.id,
      createdAt: formatDate(record.createdAt),
      action: record.action,
      actorDisplay: record.actorDisplayName,
      targetType: record.targetType,
      workspace: record.workspaceLabel ?? '',
      severity: record.severity,
      result: record.result,
      summary: record.summary,
      requestId: record.requestId ?? '',
      redactedDetails: [],
      rawMetadataProbeNeverRender: '',
    };
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatDate(value: unknown): string {
  const raw = stringValue(value);
  return raw ? new Date(raw).toLocaleString() : '';
}
