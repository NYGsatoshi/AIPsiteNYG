export type AuditFindingSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type AuditFindingStatus = 'Open' | 'Reviewing' | 'Resolved' | 'AcceptedRisk' | 'FalsePositive';
export type AuditFindingsPageStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'notFound'
  | 'permissionDenied'
  | 'error';

export interface AuditFindingHistoryViewModel {
  readonly fromStatus: AuditFindingStatus | null;
  readonly toStatus: AuditFindingStatus;
  readonly reason: string | null;
  readonly changedAt: string;
}

export interface AuditFindingViewModel {
  readonly id: string;
  readonly claimId: string;
  readonly claimOrdinal: number;
  readonly claimText: string;
  readonly severity: AuditFindingSeverity;
  readonly confidencePercent: number;
  readonly detectorKey: string;
  readonly policyVersion: string;
  readonly status: AuditFindingStatus;
  readonly ownerUserId: string | null;
  readonly ownerDisplayName: string | null;
  readonly resolutionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly relatedEvidenceId: string | null;
  readonly relatedEventId: string | null;
  readonly history: readonly AuditFindingHistoryViewModel[];
}

export interface AuditFindingsViewModel {
  readonly status: AuditFindingsPageStatus;
  readonly artifactId: string | null;
  readonly artifactVersionId: string | null;
  readonly artifactVersionNumber: number | null;
  readonly artifactTitle: string | null;
  readonly canReview: boolean;
  readonly findings: readonly AuditFindingViewModel[];
  readonly message?: string;
}

export interface AuditFindingFilters {
  readonly status: AuditFindingStatus | '';
  readonly severity: AuditFindingSeverity | '';
  readonly openOnly: boolean;
}
