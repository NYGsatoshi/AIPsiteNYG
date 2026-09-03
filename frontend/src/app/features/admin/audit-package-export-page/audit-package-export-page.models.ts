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

export const auditPackageFailureLabel = (code: string | null | undefined): string => {
    const labels = new Map<string, string>([
      ['ArtifactVersionUnavailable', 'The artifact version is no longer available.'],
      ['AuthorizationChanged', 'Authorization changed while the package was being generated.'],
      ['ExportJobCorrupt', 'The export job metadata is invalid.'],
      ['PackageBuildFailed', 'The package could not be generated.'],
      ['PackageTooLarge', 'The package exceeded the current export size limit.'],
      ['StorageWriteFailed', 'The package could not be written to export storage.'],
      ['WorkerInterrupted', 'Processing was interrupted before completion.'],
    ]);
    if (code === null || typeof code === 'undefined') {
      return 'The package export failed.';
    }
    return labels.get(code) ?? 'The package export failed.';
  },
  auditPackageFormatTimestamp = (value: string | null | undefined): string => {
    if (value === null || typeof value === 'undefined' || value === '') {
      return '—';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString();
  },
  describeAuditPackageStatus = (context: AuditPackageStatusContext): string => {
    const describeBusyStatus = (job: AuditPackageJobDto | null): string => {
        if (job?.state === 'Failed') {
          return 'Queuing Audit package export retry.';
        }
        return 'Queuing Audit package export.';
      },
      describeJobStatus = (job: AuditPackageJobDto): string => {
        switch (job.state) {
          case 'Completed': return 'Audit package export completed. Download is ready.';
          case 'Failed': return `Audit package export failed. ${auditPackageFailureLabel(job.errorCode)}`;
          case 'Processing': return `Audit package export processing, ${String(job.progressPercent)}% complete.`;
          case 'Queued': return 'Audit package export queued.';
          default: return `Audit package export status: ${job.state}.`;
        }
      },
      describePendingStatus = (statusContext: AuditPackageStatusContext): string | null => {
        if (statusContext.loadState === 'loading') {
          return 'Loading authorized Audit export scope.';
        }
        if (statusContext.busy) {
          return describeBusyStatus(statusContext.job);
        }
        if (statusContext.jobRefreshBusy) {
          return 'Refreshing Audit package export status.';
        }
        return null;
      },
      describeSettledStatus = (statusContext: AuditPackageStatusContext): string => {
        if (statusContext.jobStatusStale && statusContext.job !== null) {
          return `Export status refresh failed. Showing the last known ${statusContext.job.state} state from ${auditPackageFormatTimestamp(statusContext.jobLastUpdatedAt)}.`;
        }
        if (statusContext.message !== null) {
          return statusContext.message;
        }
        if (statusContext.job !== null) {
          return describeJobStatus(statusContext.job);
        }
        if (statusContext.hasPreview) {
          return 'Authorized Audit export scope loaded.';
        }
        return '';
      },
      pendingStatus = describePendingStatus(context);
    if (pendingStatus !== null) {
      return pendingStatus;
    }
    return describeSettledStatus(context);
  },
  isAuditPackageGuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.trim());