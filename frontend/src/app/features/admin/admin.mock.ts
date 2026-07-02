import {
  AuditLogScenario,
  AuditMockRecord,
  ExportDiagnosticsScenario,
  ExportJobMockRecord,
  RedactedDetailLine
} from './admin.types';

export const AUDIT_RAW_METADATA_PROBE =
  '{"body":"restricted body must stay hidden","secret":"hidden","storageKey":"tenant/private/key","sql":"select hidden","stackTrace":"hidden"}';

const redactedAuditDetails: readonly RedactedDetailLine[] = [
  { label: 'Target identifier', value: 'sample-target-001', state: 'shown' },
  { label: 'Content payload', value: 'Suppressed', state: 'suppressed' },
  { label: 'Sensitive values', value: 'Redacted', state: 'redacted' },
  { label: 'Internal diagnostics', value: 'Suppressed', state: 'suppressed' }
];

export const DEFAULT_AUDIT_RECORDS: readonly AuditMockRecord[] = [
  {
    id: 'audit-sample-001',
    createdAt: '2026-07-02 09:14',
    action: 'workspace.member.view',
    actorDisplay: 'Sample Admin A',
    targetType: 'WorkspaceMember',
    workspace: 'Sample Workspace Alpha',
    severity: 'info',
    result: 'success',
    summary: 'Member list opened with already-authorized rows only.',
    requestId: 'req-audit-001',
    redactedDetails: redactedAuditDetails,
    rawMetadataProbeNeverRender: AUDIT_RAW_METADATA_PROBE
  },
  {
    id: 'audit-sample-002',
    createdAt: '2026-07-02 09:22',
    action: 'file.download.denied',
    actorDisplay: 'Sample Teacher B',
    targetType: 'File',
    workspace: 'Sample Workspace Alpha',
    severity: 'warning',
    result: 'denied',
    summary: 'Download was blocked until server-side policy grants access.',
    requestId: 'req-audit-002',
    redactedDetails: redactedAuditDetails,
    rawMetadataProbeNeverRender: AUDIT_RAW_METADATA_PROBE
  },
  {
    id: 'audit-sample-003',
    createdAt: '2026-07-02 09:35',
    action: 'export.request.failed',
    actorDisplay: 'Sample Operator C',
    targetType: 'ExportJob',
    workspace: 'Sample Workspace Beta',
    severity: 'critical',
    result: 'failed',
    summary: 'Diagnostics job failed before any downloadable artifact was produced.',
    requestId: 'req-safe-<audit-003>',
    redactedDetails: redactedAuditDetails,
    rawMetadataProbeNeverRender: AUDIT_RAW_METADATA_PROBE
  }
];

export const MANY_AUDIT_RECORDS: readonly AuditMockRecord[] = Array.from({ length: 128 }, (_, index) => {
  const item = String(index + 1).padStart(3, '0');
  return {
    id: `audit-many-${item}`,
    createdAt: `2026-07-02 ${String(8 + (index % 10)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
    action: index % 3 === 0 ? 'workspace.member.view' : index % 3 === 1 ? 'file.download.denied' : 'export.request.failed',
    actorDisplay: `Sample Actor ${item}`,
    targetType: index % 2 === 0 ? 'WorkspaceMember' : 'ExportJob',
    workspace: index % 2 === 0 ? 'Sample Workspace Alpha' : 'Sample Workspace Beta',
    severity: index % 11 === 0 ? 'critical' : index % 4 === 0 ? 'warning' : 'info',
    result: index % 11 === 0 ? 'failed' : index % 4 === 0 ? 'denied' : 'success',
    summary: `Bounded audit row ${item} uses typed severity and result fields.`,
    requestId: `req-audit-many-${item}`,
    redactedDetails: redactedAuditDetails,
    rawMetadataProbeNeverRender: AUDIT_RAW_METADATA_PROBE
  };
});

const longAuditRecord: AuditMockRecord = {
  ...DEFAULT_AUDIT_RECORDS[0],
  id: 'audit-long-summary',
  summary:
    'This long operational summary is intentionally verbose so the grid can prove wrapping without exposing payload content, restricted values, diagnostics, or raw metadata.'
};

const exportDetails: readonly RedactedDetailLine[] = [
  { label: 'Scope owner', value: 'Sample Workspace Alpha', state: 'shown' },
  { label: 'Artifact location', value: 'Suppressed until server reauthorization', state: 'suppressed' },
  { label: 'Sensitive values', value: 'Redacted', state: 'redacted' }
];

export const DEFAULT_EXPORT_JOBS: readonly ExportJobMockRecord[] = [
  {
    id: 'export-job-001',
    createdAt: '2026-07-02 09:10',
    jobType: 'ExportDiagnostics',
    status: 'succeeded',
    requestedBy: 'Sample Admin A',
    scope: 'Sample Workspace Alpha',
    result: 'available',
    requestId: 'req-export-001',
    redactedDetails: exportDetails
  },
  {
    id: 'export-job-002',
    createdAt: '2026-07-02 09:30',
    jobType: 'ExportDiagnostics',
    status: 'running',
    requestedBy: 'Sample Operator C',
    scope: 'Sample Workspace Beta',
    result: 'notReady',
    requestId: 'req-export-002',
    redactedDetails: exportDetails
  }
];

export const AUDIT_LOG_SCENARIOS = {
  default: {
    status: 'ready',
    title: 'Admin audit log',
    subtitle: 'Mock metadata-safe audit grid',
    auditRecords: DEFAULT_AUDIT_RECORDS
  },
  loading: {
    status: 'loading',
    title: 'Admin audit log',
    subtitle: 'Mock metadata-safe audit grid',
    auditRecords: []
  },
  empty: {
    status: 'empty',
    title: 'Admin audit log',
    subtitle: 'Mock metadata-safe audit grid',
    auditRecords: []
  },
  permissionDenied: {
    status: 'permissionDenied',
    title: 'Admin audit log',
    subtitle: 'Mock metadata-safe audit grid',
    auditRecords: [],
    message: 'Audit log access is not available for this mock session.'
  },
  manyRowsBoundedPage: {
    status: 'ready',
    title: 'Admin audit log',
    subtitle: 'Mock metadata-safe audit grid',
    auditRecords: MANY_AUDIT_RECORDS
  },
  longMessage: {
    status: 'ready',
    title: 'Admin audit log',
    subtitle: 'Mock metadata-safe audit grid',
    auditRecords: [longAuditRecord, ...DEFAULT_AUDIT_RECORDS]
  },
  redactedDetailDrawer: {
    status: 'ready',
    title: 'Admin audit log',
    subtitle: 'Mock metadata-safe audit grid',
    auditRecords: DEFAULT_AUDIT_RECORDS,
    initialSelectedAuditId: DEFAULT_AUDIT_RECORDS[1].id
  }
} satisfies Record<string, AuditLogScenario>;

export const EXPORT_DIAGNOSTICS_SCENARIOS = {
  default: {
    status: 'ready',
    title: 'Export diagnostics',
    subtitle: 'Mock server-owned export job queue',
    exportJobs: DEFAULT_EXPORT_JOBS,
    canRequestDiagnosticsExport: true
  },
  allowed: {
    status: 'ready',
    title: 'Export diagnostics',
    subtitle: 'Mock server-owned export job queue',
    exportJobs: DEFAULT_EXPORT_JOBS,
    canRequestDiagnosticsExport: true
  },
  notAllowed: {
    status: 'ready',
    title: 'Export diagnostics',
    subtitle: 'Mock server-owned export job queue',
    exportJobs: DEFAULT_EXPORT_JOBS,
    canRequestDiagnosticsExport: false
  },
  pending: {
    status: 'ready',
    title: 'Export diagnostics',
    subtitle: 'Mock server-owned export job queue',
    exportJobs: [
      {
        ...DEFAULT_EXPORT_JOBS[0],
        id: 'export-job-pending',
        status: 'pending',
        result: 'notReady',
        requestId: 'req-export-pending'
      }
    ],
    canRequestDiagnosticsExport: true,
    initialSelectedJobId: 'export-job-pending'
  },
  failed: {
    status: 'ready',
    title: 'Export diagnostics',
    subtitle: 'Mock server-owned export job queue',
    exportJobs: [
      {
        ...DEFAULT_EXPORT_JOBS[0],
        id: 'export-job-failed',
        status: 'failed',
        result: 'failed',
        requestId: 'req-export-failed'
      }
    ],
    canRequestDiagnosticsExport: true,
    initialSelectedJobId: 'export-job-failed'
  }
} satisfies Record<string, ExportDiagnosticsScenario>;
