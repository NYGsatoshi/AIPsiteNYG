export interface AuditPackageSectionPreviewDto {
  readonly itemCount: number;
  readonly key: string;
  readonly label: string;
}

export interface AuditPackagePreviewDto {
  readonly artifactId: string;
  readonly artifactTitle: string;
  readonly artifactVersionId: string;
  readonly artifactVersionNumber: number;
  readonly canExport: boolean;
  readonly scopeLabel: string;
  readonly sections: readonly AuditPackageSectionPreviewDto[];
  readonly sensitiveMetadataIncluded: boolean;
}

export interface AuditPackageJobDto {
  readonly artifactVersionId: string;
  readonly completedAt?: string | null;
  readonly createdAt: string;
  readonly errorCode?: string | null;
  readonly fileName: string;
  readonly jobId: string;
  readonly progressPercent: number;
  readonly state: string;
}

export type AuditPackageLoadState = 'error' | 'idle' | 'loading' | 'notFound' | 'permissionDenied' | 'ready';

export interface AuditPackageStatusContext {
  readonly busy: boolean;
  readonly hasPreview: boolean;
  readonly job: AuditPackageJobDto | null;
  readonly jobLastUpdatedAt: string | null;
  readonly jobRefreshBusy: boolean;
  readonly jobStatusStale: boolean;
  readonly loadState: AuditPackageLoadState;
  readonly message: string | null;
}

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const genericFailureLabel = 'The package export failed.';

const failureLabelFromCode = (code: string): string => {
  switch (code) {
    case 'ArtifactVersionUnavailable': return 'The artifact version is no longer available.';
    case 'AuthorizationChanged': return 'Authorization changed while the package was being generated.';
    case 'ExportJobCorrupt': return 'The export job metadata is invalid.';
    case 'PackageBuildFailed': return 'The package could not be generated.';
    case 'PackageTooLarge': return 'The package exceeded the current export size limit.';
    case 'StorageWriteFailed': return 'The package could not be written to export storage.';
    case 'WorkerInterrupted': return 'Processing was interrupted before completion.';
    default: return genericFailureLabel;
  }
};

export const auditPackageFailureLabel = (code: string | null | undefined): string => {
  if (code === null || typeof code === 'undefined') {
    return genericFailureLabel;
  }
  return failureLabelFromCode(code);
};

export const formatAuditPackageTimestamp = (value: string | null | undefined): string => {
  if (value === null || typeof value === 'undefined' || value.length === 0) {
    return '—';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

export const isAuditPackageGuid = (value: string): boolean => guidPattern.test(value.trim());

const describeBusyStatus = (job: AuditPackageJobDto | null): string => {
  if (job?.state === 'Failed') {
    return 'Queuing Audit package export retry.';
  }
  return 'Queuing Audit package export.';
};

const describeJobStatus = (job: AuditPackageJobDto): string => {
  switch (job.state) {
    case 'Completed': return 'Audit package export completed. Download is ready.';
    case 'Failed': return `Audit package export failed. ${auditPackageFailureLabel(job.errorCode)}`;
    case 'Processing': return `Audit package export processing, ${String(job.progressPercent)}% complete.`;
    case 'Queued': return 'Audit package export queued.';
    default: return `Audit package export status: ${job.state}.`;
  }
};

const describePendingStatus = (context: AuditPackageStatusContext): string | null => {
  if (context.loadState === 'loading') {
    return 'Loading authorized Audit export scope.';
  }
  if (context.busy) {
    return describeBusyStatus(context.job);
  }
  if (context.jobRefreshBusy) {
    return 'Refreshing Audit package export status.';
  }
  return null;
};

const describeSettledStatus = (context: AuditPackageStatusContext): string => {
  if (context.jobStatusStale && context.job !== null) {
    return `Export status refresh failed. Showing the last known ${context.job.state} state from ${formatAuditPackageTimestamp(context.jobLastUpdatedAt)}.`;
  }
  if (context.message !== null) {
    return context.message;
  }
  if (context.job !== null) {
    return describeJobStatus(context.job);
  }
  if (context.hasPreview) {
    return 'Authorized Audit export scope loaded.';
  }
  return '';
};

export const describeAuditPackageStatus = (context: AuditPackageStatusContext): string => {
  const pendingStatus = describePendingStatus(context);
  if (pendingStatus !== null) {
    return pendingStatus;
  }
  return describeSettledStatus(context);
};