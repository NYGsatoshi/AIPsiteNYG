import { inject, Injectable, InjectionToken } from '@angular/core';

import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_MAXIMUM_PAGE_SIZE,
  AUDIT_TYPED_FIELD_NOTE,
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
  ExportJobStatus
} from './admin.types';
import { AUDIT_LOG_SCENARIOS, EXPORT_DIAGNOSTICS_SCENARIOS } from './admin.mock';

export const AIP_ADMIN_AUDIT_MOCK = new InjectionToken<AuditLogScenario>('AIP_ADMIN_AUDIT_MOCK');
export const AIP_EXPORT_DIAGNOSTICS_MOCK = new InjectionToken<ExportDiagnosticsScenario>(
  'AIP_EXPORT_DIAGNOSTICS_MOCK'
);

const severityLabels: Record<AuditSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical'
};

const resultLabels: Record<AuditResult, string> = {
  success: 'Success',
  denied: 'Denied',
  failed: 'Failed'
};

const statusLabels: Record<ExportJobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed'
};

const exportResultLabels: Record<ExportJobResult, string> = {
  notReady: 'Not ready',
  available: 'Available after server check',
  failed: 'Failed',
  suppressed: 'Suppressed'
};

@Injectable({
  providedIn: 'root'
})
export class AdminFacade {
  private readonly auditScenario: AuditLogScenario =
    inject(AIP_ADMIN_AUDIT_MOCK, { optional: true }) ?? AUDIT_LOG_SCENARIOS.default;
  private readonly exportScenario: ExportDiagnosticsScenario =
    inject(AIP_EXPORT_DIAGNOSTICS_MOCK, { optional: true }) ?? EXPORT_DIAGNOSTICS_SCENARIOS.default;

  getAuditLog(): AuditLogViewModel {
    return {
      status: this.auditScenario.status,
      title: this.auditScenario.title,
      subtitle: this.auditScenario.subtitle,
      rows: this.auditScenario.auditRecords.map((record) => this.toAuditGridRow(record)),
      columns: [],
      pageSize: {
        defaultPageSize: ADMIN_DEFAULT_PAGE_SIZE,
        maximumPageSize: ADMIN_MAXIMUM_PAGE_SIZE
      },
      typedFieldNote: AUDIT_TYPED_FIELD_NOTE,
      initialSelectedAuditId: this.auditScenario.initialSelectedAuditId,
      message: this.auditScenario.message
    };
  }

  getExportDiagnostics(): ExportDiagnosticsViewModel {
    return {
      status: this.exportScenario.status,
      title: this.exportScenario.title,
      subtitle: this.exportScenario.subtitle,
      rows: this.exportScenario.exportJobs.map((job) => this.toExportJobGridRow(job)),
      columns: [],
      pageSize: {
        defaultPageSize: ADMIN_DEFAULT_PAGE_SIZE,
        maximumPageSize: ADMIN_MAXIMUM_PAGE_SIZE
      },
      canRequestDiagnosticsExport: this.exportScenario.canRequestDiagnosticsExport,
      authorizationNote: EXPORT_AUTHORIZATION_NOTE,
      initialSelectedJobId: this.exportScenario.initialSelectedJobId,
      message: this.exportScenario.message
    };
  }

  requestDiagnosticsJob(): ExportJobGridRow {
    return this.toExportJobGridRow({
      id: `export-job-requested-${Date.now()}`,
      createdAt: '2026-07-02 10:00',
      jobType: 'ExportDiagnostics',
      status: 'pending',
      requestedBy: 'Current Mock Admin',
      scope: 'Current authorized scope',
      result: 'notReady',
      requestId: 'req-export-new',
      redactedDetails: [
        { label: 'Scope owner', value: 'Current authorized scope', state: 'shown' },
        { label: 'Artifact location', value: 'Suppressed until server reauthorization', state: 'suppressed' },
        { label: 'Sensitive values', value: 'Redacted', state: 'redacted' }
      ]
    });
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
      redactedDetails: record.redactedDetails
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
      redactedDetails: job.redactedDetails
    };
  }
}
