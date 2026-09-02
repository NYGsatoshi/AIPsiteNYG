export type AuditFindingSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type AuditFindingStatus = 'Open' | 'Reviewing' | 'Resolved' | 'AcceptedRisk' | 'FalsePositive';
export type AuditFindingWorkflowStatus = 'Open' | 'InReview' | 'WaitingFix' | 'ReadyForReReview' | 'Done';
export type AuditFindingsPageStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'notFound'
  | 'permissionDenied'
  | 'error';

export interface AuditFindingOwnerViewModel {
  readonly userId: string;
  readonly displayName: string;
}

export interface AuditFindingHistoryViewModel {
  readonly fromStatus: AuditFindingStatus | null;
  readonly toStatus: AuditFindingStatus;
  readonly reason: string | null;
  readonly changedAt: string;
}

export interface AuditFindingWorkflowHistoryViewModel {
  readonly fromWorkflowStatus: AuditFindingWorkflowStatus;
  readonly toWorkflowStatus: AuditFindingWorkflowStatus;
  readonly fromOwnerUserId: string | null;
  readonly fromOwnerDisplayName: string | null;
  readonly toOwnerUserId: string | null;
  readonly toOwnerDisplayName: string | null;
  readonly fromDueDate: string | null;
  readonly toDueDate: string | null;
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
  readonly workflowStatus: AuditFindingWorkflowStatus;
  readonly ownerUserId: string | null;
  readonly ownerDisplayName: string | null;
  readonly dueDate: string | null;
  readonly isOverdue: boolean;
  readonly resolutionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly relatedEvidenceId: string | null;
  readonly relatedEventId: string | null;
  readonly history: readonly AuditFindingHistoryViewModel[];
  readonly workflowHistory: readonly AuditFindingWorkflowHistoryViewModel[];
}

export interface AuditFindingsViewModel {
  readonly status: AuditFindingsPageStatus;
  readonly artifactId: string | null;
  readonly artifactVersionId: string | null;
  readonly artifactVersionNumber: number | null;
  readonly artifactTitle: string | null;
  readonly canReview: boolean;
  readonly eligibleOwners: readonly AuditFindingOwnerViewModel[];
  readonly findings: readonly AuditFindingViewModel[];
  readonly message?: string;
}

export interface AuditFindingFilters {
  readonly status: AuditFindingStatus | '';
  readonly severity: AuditFindingSeverity | '';
  readonly openOnly: boolean;
  readonly workflowStatus: AuditFindingWorkflowStatus | '';
  readonly myReviews: boolean;
  readonly overdue: boolean;
  readonly unassigned: boolean;
}
