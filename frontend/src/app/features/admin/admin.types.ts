import { AppDataGridColumnDef } from '../../shared/grid/app-data-grid/app-data-grid.types';

export const ADMIN_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_MAXIMUM_PAGE_SIZE = 100;

export type AdminPageStatus = 'ready' | 'loading' | 'empty' | 'error' | 'permissionDenied';
/**
 * Kept local to the read-only Audit list. It distinguishes first render from
 * a guarded, manual retry without inventing paging, filtering, or stale-data
 * semantics that the current endpoint does not expose.
 */
export type AuditLogLoadPhase = 'idle' | 'initial' | 'retry';
export type AuditDetailStatus = 'idle' | 'loading' | 'ready' | 'notFound' | 'permissionDenied' | 'error';
export type AuditSensitiveMetadataStatus =
  | 'hidden'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'notFound'
  | 'permissionDenied'
  | 'error';
export type AuditSeverity = 'info' | 'warning' | 'critical';
export type AuditResult = 'success' | 'denied' | 'failed';
export type AuditSeverityFilter = '' | AuditSeverity;
export type AuditStatusFilter = '' | AuditResult;
export type AuditTimeRange = '' | '24h' | '7d' | '30d';

export interface AuditFilterSnapshot {
  readonly q: string;
  readonly severity: AuditSeverityFilter;
  readonly type: string;
  readonly actor: string;
  readonly source: string;
  readonly status: AuditStatusFilter;
  readonly range: AuditTimeRange;
}

export const EMPTY_AUDIT_FILTERS: AuditFilterSnapshot = {
  q: '',
  severity: '',
  type: '',
  actor: '',
  source: '',
  status: '',
  range: '',
};

export interface AuditSavedView {
  readonly id: string;
  readonly name: string;
  readonly snapshot: AuditFilterSnapshot;
}
/**
 * The API contract currently classifies these values as `AuditSeverity` and
 * `AuditResult`. Keep an explicit, neutral display state for an unexpected
 * wire value so the audit UI never renders a blank or color-only status.
 */
export type AuditSeverityDisplay = AuditSeverity | 'unclassified';
export type AuditResultDisplay = AuditResult | 'unclassified';
export type ExportJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type ExportJobResult = 'notReady' | 'available' | 'failed' | 'suppressed';

export const AUDIT_TYPED_FIELD_NOTE = {
  owner: 'backendApiTypedFieldsWhenLive',
  severityResultSource: 'typedViewModelFields',
  metadataParsing: 'serverAuthorizedProgressiveDisclosure'
} as const;

export const EXPORT_AUTHORIZATION_NOTE = {
  requestOwner: 'backendOwnedWhenLive',
  downloadOwner: 'backendReauthorizedWhenLive',
  uiHiding: 'notAuthorization'
} as const;

export interface AdminPageSizePolicy {
  readonly defaultPageSize: typeof ADMIN_DEFAULT_PAGE_SIZE;
  readonly maximumPageSize: typeof ADMIN_MAXIMUM_PAGE_SIZE;
}

export interface RedactedDetailLine {
  readonly label: string;
  readonly value: string;
  readonly state: 'shown' | 'redacted' | 'suppressed';
}

export interface AuditMockRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly action: string;
  readonly actorDisplay: string;
  readonly targetType: string;
  readonly workspace: string;
  readonly severity: AuditSeverityDisplay;
  readonly result: AuditResultDisplay;
  readonly summary: string;
  readonly requestId: string;
  readonly redactedDetails: readonly RedactedDetailLine[];
  readonly rawMetadataProbeNeverRender: string;
}

export interface AuditGridRow {
  readonly id: string;
  readonly createdAt: string;
  readonly action: string;
  readonly actorDisplay: string;
  readonly targetType: string;
  readonly workspace: string;
  readonly severity: AuditSeverityDisplay;
  readonly severityLabel: string;
  readonly result: AuditResultDisplay;
  readonly resultLabel: string;
  readonly summary: string;
  readonly requestId: string;
  readonly redactedDetails: readonly RedactedDetailLine[];
}

export interface AuditLogViewModel {
  readonly status: AdminPageStatus;
  readonly loadPhase: AuditLogLoadPhase;
  readonly canRetry: boolean;
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly AuditGridRow[];
  readonly totalCount: number;
  readonly appliedFilters: AuditFilterSnapshot;
  readonly columns: readonly AppDataGridColumnDef<AuditGridRow>[];
  readonly pageSize: AdminPageSizePolicy;
  readonly typedFieldNote: typeof AUDIT_TYPED_FIELD_NOTE;
  readonly message?: string;
}

/**
 * The drawer reuses the audit-grid projection for its initial view. Sensitive
 * metadata has a separate exact-event state and is never part of this model.
 */
export interface AuditDetailViewModel {
  readonly status: AuditDetailStatus;
  readonly auditId: string | null;
  readonly row: AuditGridRow | null;
  readonly message?: string;
}

export interface AuditCapabilityViewModel {
  readonly loaded: boolean;
  readonly canViewSensitiveMetadata: boolean;
}

export interface AuditSensitiveMetadataViewModel {
  readonly status: AuditSensitiveMetadataStatus;
  readonly auditId: string | null;
  readonly formattedJson: string;
  readonly redactionApplied: boolean;
  readonly message?: string;
}

export interface AuditLogScenario {
  readonly status: AdminPageStatus;
  readonly loadPhase?: AuditLogLoadPhase;
  readonly canRetry?: boolean;
  readonly title: string;
  readonly subtitle: string;
  readonly auditRecords: readonly AuditMockRecord[];
  readonly canViewSensitiveMetadata?: boolean;
  readonly message?: string;
}

export interface ExportJobMockRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly jobType: string;
  readonly status: ExportJobStatus;
  readonly requestedBy: string;
  readonly scope: string;
  readonly result: ExportJobResult;
  readonly requestId: string;
  readonly redactedDetails: readonly RedactedDetailLine[];
}

export interface ExportJobGridRow {
  readonly id: string;
  readonly createdAt: string;
  readonly jobType: string;
  readonly status: ExportJobStatus;
  readonly statusLabel: string;
  readonly requestedBy: string;
  readonly scope: string;
  readonly result: ExportJobResult;
  readonly resultLabel: string;
  readonly requestId: string;
  readonly redactedDetails: readonly RedactedDetailLine[];
}

export interface ExportDiagnosticsViewModel {
  readonly status: AdminPageStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly ExportJobGridRow[];
  readonly columns: readonly AppDataGridColumnDef<ExportJobGridRow>[];
  readonly pageSize: AdminPageSizePolicy;
  readonly canRequestDiagnosticsExport: boolean;
  readonly authorizationNote: typeof EXPORT_AUTHORIZATION_NOTE;
  readonly initialSelectedJobId?: string;
  readonly message?: string;
}

export interface ExportDiagnosticsScenario {
  readonly status: AdminPageStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly exportJobs: readonly ExportJobMockRecord[];
  readonly canRequestDiagnosticsExport: boolean;
  readonly initialSelectedJobId?: string;
  readonly message?: string;
}
