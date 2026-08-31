import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { forkJoin } from 'rxjs';

import {
  AuditActionSummaryViewModel,
  AuditClaimReviewStatus,
  AuditClaimSupportStatus,
  AuditClaimViewModel,
  AuditClaimsEvidenceViewModel,
  AuditEvidenceSourceKind,
  AuditEvidenceViewModel,
} from './audit-claims-evidence.types';

interface AuditClaimsEvidenceDto {
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly artifactVersionNumber: number;
  readonly artifactTitle: string;
  readonly claims?: readonly AuditClaimEvidenceDto[];
}

interface AuditClaimEvidenceDto {
  readonly claimId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly citationPresent: boolean;
  readonly supportStatus: unknown;
  readonly reviewStatus: unknown;
  readonly evidence?: readonly AuditEvidenceDto[];
}

interface AuditEvidenceDto {
  readonly evidenceId: string;
  readonly ordinal: number;
  readonly sourceKind: unknown;
  readonly sourceReference: string;
  readonly sourceTitle?: string | null;
  readonly passage: string;
  readonly location?: string | null;
  readonly sourceEventAuditId?: string | null;
}

interface PagedResponseDto {
  readonly totalCount?: unknown;
}

const supportLabels: Record<AuditClaimSupportStatus, string> = {
  Unverified: 'Support not verified',
  Supported: 'Supported',
  Contradicted: 'Contradiction',
  Insufficient: 'Insufficient evidence',
  Unsupported: 'Unsupported',
};

@Injectable({ providedIn: 'root' })
export class AuditClaimsEvidenceFacade {
  private readonly http = inject(HttpClient);
  private readonly state = signal<AuditClaimsEvidenceViewModel>(emptyState('idle'));
  private readonly summaryState = signal<AuditActionSummaryViewModel>(emptySummary('idle'));
  private requestVersion = 0;
  private summaryRequestVersion = 0;

  readonly viewModel = this.state.asReadonly();
  readonly actionSummary = this.summaryState.asReadonly();

  clear(): void {
    this.requestVersion += 1;
    this.state.set(emptyState('idle'));
  }

  loadActionSummary(): void {
    const requestVersion = ++this.summaryRequestVersion;
    this.summaryState.set(emptySummary('loading'));

    const commonParams = new HttpParams()
      .set('page', '1')
      .set('pageSize', '1');

    forkJoin({
      warning: this.http.get<PagedResponseDto>('/api/admin/audit-grid', {
        params: commonParams.set('severity', 'warning'),
        withCredentials: true,
      }),
      error: this.http.get<PagedResponseDto>('/api/admin/audit-grid', {
        params: commonParams.set('result', 'failed'),
        withCredentials: true,
      }),
    }).subscribe({
      next: ({ warning, error }) => {
        if (requestVersion !== this.summaryRequestVersion) {
          return;
        }

        const warningCount = toAuthorizedCount(warning.totalCount);
        const errorCount = toAuthorizedCount(error.totalCount);
        if (warningCount === null || errorCount === null) {
          this.summaryState.set({
            ...emptySummary('error'),
            message: 'Actionable Audit counts could not be verified.',
          });
          return;
        }

        this.summaryState.set({
          status: 'ready',
          warningCount,
          errorCount,
        });
      },
      error: (error: { status?: number }) => {
        if (requestVersion !== this.summaryRequestVersion) {
          return;
        }

        const permissionDenied = error.status === 401 || error.status === 403;
        this.summaryState.set({
          ...emptySummary(permissionDenied ? 'permissionDenied' : 'error'),
          message: permissionDenied
            ? 'Audit permission is required to load actionable event counts.'
            : 'Actionable Audit counts could not be loaded.',
        });
      },
    });
  }

  load(artifactVersionId: string): void {
    const normalized = artifactVersionId.trim();
    if (!normalized) {
      this.clear();
      return;
    }

    const requestVersion = ++this.requestVersion;
    this.state.set({
      ...emptyState('loading'),
      artifactVersionId: normalized,
    });

    const params = new HttpParams().set('artifactVersionId', normalized);
    this.http
      .get<AuditClaimsEvidenceDto>('/api/admin/audit/claims-evidence', {
        params,
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          if (requestVersion !== this.requestVersion) {
            return;
          }

          const claims = (response.claims ?? []).map(toClaimViewModel);
          this.state.set({
            status: claims.length === 0 ? 'empty' : 'ready',
            artifactId: response.artifactId,
            artifactVersionId: response.artifactVersionId,
            artifactVersionNumber: response.artifactVersionNumber,
            artifactTitle: response.artifactTitle,
            claims,
            message: claims.length === 0
              ? 'No claims are attached to this authorized artifact version.'
              : undefined,
          });
        },
        error: (error: { status?: number }) => {
          if (requestVersion !== this.requestVersion) {
            return;
          }

          if (error.status === 401 || error.status === 403) {
            this.state.set({
              ...emptyState('permissionDenied'),
              artifactVersionId: normalized,
              message: 'Audit view permission is required for Claims & Evidence.',
            });
            return;
          }

          if (error.status === 404) {
            this.state.set({
              ...emptyState('notFound'),
              artifactVersionId: normalized,
              message: 'The artifact version is not available in the current authorized scope.',
            });
            return;
          }

          this.state.set({
            ...emptyState('error'),
            artifactVersionId: normalized,
            message: 'Claims & Evidence could not be loaded.',
          });
        },
      });
  }
}

function emptyState(status: AuditClaimsEvidenceViewModel['status']): AuditClaimsEvidenceViewModel {
  return {
    status,
    artifactId: null,
    artifactVersionId: null,
    artifactVersionNumber: null,
    artifactTitle: null,
    claims: [],
  };
}

function emptySummary(status: AuditActionSummaryViewModel['status']): AuditActionSummaryViewModel {
  return {
    status,
    warningCount: null,
    errorCount: null,
  };
}

function toClaimViewModel(dto: AuditClaimEvidenceDto): AuditClaimViewModel {
  const supportStatus = toSupportStatus(dto.supportStatus);
  return {
    id: dto.claimId,
    ordinal: safeOrdinal(dto.ordinal),
    text: dto.text,
    citationPresent: dto.citationPresent === true,
    supportStatus,
    supportLabel: supportLabels[supportStatus],
    reviewStatus: toReviewStatus(dto.reviewStatus),
    evidence: (dto.evidence ?? []).map(toEvidenceViewModel),
  };
}

function toEvidenceViewModel(dto: AuditEvidenceDto): AuditEvidenceViewModel {
  return {
    id: dto.evidenceId,
    ordinal: safeOrdinal(dto.ordinal),
    sourceKind: toSourceKind(dto.sourceKind),
    sourceReference: dto.sourceReference,
    sourceTitle: dto.sourceTitle?.trim() || null,
    passage: dto.passage,
    location: dto.location?.trim() || null,
    sourceEventAuditId: dto.sourceEventAuditId?.trim() || null,
  };
}

function toSupportStatus(value: unknown): AuditClaimSupportStatus {
  return value === 'Supported' ||
    value === 'Contradicted' ||
    value === 'Insufficient' ||
    value === 'Unsupported'
    ? value
    : 'Unverified';
}

function toReviewStatus(value: unknown): AuditClaimReviewStatus {
  return value === 'Reviewed' ? 'Reviewed' : 'Unreviewed';
}

function toSourceKind(value: unknown): AuditEvidenceSourceKind {
  return value === 'WebSnapshot' || value === 'FileAttachment' || value === 'ArtifactVersion'
    ? value
    : 'Source';
}

function safeOrdinal(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function toAuthorizedCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
