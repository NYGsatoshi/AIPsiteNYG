export type AuditClaimsEvidenceStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'notFound'
  | 'permissionDenied'
  | 'error';

export type AuditActionSummaryStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'permissionDenied'
  | 'error';

export type AuditClaimSupportStatus =
  | 'Unverified'
  | 'Supported'
  | 'Contradicted'
  | 'Insufficient'
  | 'Unsupported';
export type AuditClaimSupportFilter = '' | 'Unverified';
export type AuditClaimReviewStatus = 'Unreviewed' | 'Reviewed';
export type AuditEvidenceSourceKind = 'WebSnapshot' | 'FileAttachment' | 'ArtifactVersion' | 'Source';
export type AuditEvidenceSourceClassification = 'Unknown' | 'Primary' | 'Secondary';
export type AuditEvidenceVerificationStatus = 'Unverified' | 'Verified' | 'Rejected';

export interface AuditActionSummaryViewModel {
  readonly status: AuditActionSummaryStatus;
  readonly warningCount: number | null;
  readonly errorCount: number | null;
  readonly message?: string;
}

export interface AuditEvidenceViewModel {
  readonly id: string;
  readonly ordinal: number;
  readonly sourceKind: AuditEvidenceSourceKind;
  readonly sourceReference: string;
  readonly sourceTitle: string | null;
  readonly passage: string;
  readonly location: string | null;
  readonly sourceEventAuditId: string | null;
  readonly sourceId: string | null;
  readonly sourcePublisher: string | null;
  readonly sourceType: string | null;
  readonly sourceClassification: AuditEvidenceSourceClassification;
  readonly publishedAt: string | null;
  readonly retrievedAt: string | null;
  readonly contentHash: string | null;
  readonly sourceVersion: string | null;
  readonly verificationStatus: AuditEvidenceVerificationStatus;
}

export interface AuditClaimViewModel {
  readonly id: string;
  readonly ordinal: number;
  readonly text: string;
  readonly citationPresent: boolean;
  readonly supportStatus: AuditClaimSupportStatus;
  readonly supportLabel: string;
  readonly reviewStatus: AuditClaimReviewStatus;
  readonly evidence: readonly AuditEvidenceViewModel[];
}

export interface AuditClaimsEvidenceViewModel {
  readonly status: AuditClaimsEvidenceStatus;
  readonly artifactId: string | null;
  readonly artifactVersionId: string | null;
  readonly artifactVersionNumber: number | null;
  readonly artifactTitle: string | null;
  readonly claims: readonly AuditClaimViewModel[];
  readonly message?: string;
}
