import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';

import {
  AuditFindingFilters,
  AuditFindingHistoryViewModel,
  AuditFindingOwnerViewModel,
  AuditFindingSeverity,
  AuditFindingStatus,
  AuditFindingViewModel,
  AuditFindingsViewModel,
} from './audit-findings.types';

interface AuditFindingsDto {
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly artifactVersionNumber: number;
  readonly artifactTitle: string;
  readonly canReview: boolean;
  readonly eligibleOwners?: readonly AuditFindingOwnerDto[];
  readonly findings?: readonly AuditFindingDto[];
}

interface AuditFindingOwnerDto {
  readonly userId: string;
  readonly displayName: string;
}

interface AuditFindingDto {
  readonly findingId: string;
  readonly claimId: string;
  readonly claimOrdinal: number;
  readonly claimText: string;
  readonly severity: unknown;
  readonly confidencePercent: unknown;
  readonly detectorKey: string;
  readonly policyVersion: string;
  readonly status: unknown;
  readonly ownerUserId?: string | null;
  readonly ownerDisplayName?: string | null;
  readonly resolutionReason?: string | null;
  readonly createdAt: string;
  readonly updatedAt?: string | null;
  readonly relatedEvidenceId?: string | null;
  readonly relatedEventId?: string | null;
  readonly history?: readonly AuditFindingHistoryDto[];
}

interface AuditFindingHistoryDto {
  readonly fromStatus?: unknown;
  readonly toStatus: unknown;
  readonly reason?: string | null;
  readonly changedAt: string;
}

@Injectable({ providedIn: 'root' })
export class AuditFindingsFacade {
  private readonly http = inject(HttpClient);
  private readonly state = signal<AuditFindingsViewModel>(emptyState('idle'));
  private readonly savingState = signal(false);
  private readonly mutationErrorState = signal<string | null>(null);
  private requestVersion = 0;
  private lastRequest: { artifactVersionId: string; filters: AuditFindingFilters } | null = null;

  readonly viewModel = this.state.asReadonly();
  readonly saving = this.savingState.asReadonly();
  readonly mutationError = this.mutationErrorState.asReadonly();

  clear(): void {
    this.requestVersion += 1;
    this.lastRequest = null;
    this.state.set(emptyState('idle'));
    this.mutationErrorState.set(null);
  }

  load(artifactVersionId: string, filters: AuditFindingFilters): void {
    const normalized = artifactVersionId.trim();
    if (!normalized) {
      this.clear();
      return;
    }

    const requestVersion = ++this.requestVersion;
    this.lastRequest = { artifactVersionId: normalized, filters: { ...filters } };
    this.state.set({
      ...emptyState('loading'),
      artifactVersionId: normalized,
    });
    this.mutationErrorState.set(null);

    let params = new HttpParams().set('artifactVersionId', normalized);
    if (filters.status) {
      params = params.set('status', filters.status);
    }
    if (filters.severity) {
      params = params.set('severity', filters.severity);
    }
    if (filters.openOnly) {
      params = params.set('openOnly', 'true');
    }

    this.http
      .get<AuditFindingsDto>('/api/admin/audit/findings', {
        params,
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          if (requestVersion !== this.requestVersion) {
            return;
          }

          const findings = (response.findings ?? []).map(toFindingViewModel);
          this.state.set({
            status: findings.length === 0 ? 'empty' : 'ready',
            artifactId: response.artifactId,
            artifactVersionId: response.artifactVersionId,
            artifactVersionNumber: response.artifactVersionNumber,
            artifactTitle: response.artifactTitle,
            canReview: response.canReview === true,
            eligibleOwners: response.canReview === true
              ? (response.eligibleOwners ?? []).map(toOwnerViewModel)
              : [],
            findings,
            message: findings.length === 0
              ? 'No authorized findings match the current triage filters.'
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
              message: 'Audit view permission is required for Findings triage.',
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
            message: 'Findings triage could not be loaded.',
          });
        },
      });
  }

  updateTriage(
    findingId: string,
    status: AuditFindingStatus,
    reason: string | null,
    ownerUserId: string | null = null,
    assignOwner = false,
  ): void {
    if (this.savingState()) {
      return;
    }

    this.savingState.set(true);
    this.mutationErrorState.set(null);
    this.http
      .patch<void>(
        `/api/admin/audit/findings/${encodeURIComponent(findingId)}/triage`,
        { status, reason, ownerUserId, assignOwner },
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.savingState.set(false);
          const request = this.lastRequest;
          if (request) {
            this.load(request.artifactVersionId, request.filters);
          }
        },
        error: (error: { status?: number }) => {
          this.savingState.set(false);
          this.mutationErrorState.set(
            error.status === 401 || error.status === 403
              ? 'Audit review permission is required to change finding triage.'
              : error.status === 404
                ? 'The finding is no longer available in the current authorized scope.'
                : error.status === 400 && assignOwner
                  ? 'The selected owner is no longer eligible for this finding.'
                  : 'The finding triage change could not be saved.',
          );
        },
      });
  }
}

function emptyState(status: AuditFindingsViewModel['status']): AuditFindingsViewModel {
  return {
    status,
    artifactId: null,
    artifactVersionId: null,
    artifactVersionNumber: null,
    artifactTitle: null,
    canReview: false,
    eligibleOwners: [],
    findings: [],
  };
}

function toOwnerViewModel(dto: AuditFindingOwnerDto): AuditFindingOwnerViewModel {
  return {
    userId: dto.userId.trim(),
    displayName: dto.displayName.trim() || 'Unnamed member',
  };
}

function toFindingViewModel(dto: AuditFindingDto): AuditFindingViewModel {
  return {
    id: dto.findingId,
    claimId: dto.claimId,
    claimOrdinal: safePositiveInteger(dto.claimOrdinal, 1),
    claimText: dto.claimText,
    severity: toSeverity(dto.severity),
    confidencePercent: clampConfidence(dto.confidencePercent),
    detectorKey: dto.detectorKey,
    policyVersion: dto.policyVersion,
    status: toStatus(dto.status),
    ownerUserId: dto.ownerUserId?.trim() || null,
    ownerDisplayName: dto.ownerDisplayName?.trim() || null,
    resolutionReason: dto.resolutionReason?.trim() || null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt?.trim() || null,
    relatedEvidenceId: dto.relatedEvidenceId?.trim() || null,
    relatedEventId: dto.relatedEventId?.trim() || null,
    history: (dto.history ?? []).map(toHistoryViewModel),
  };
}

function toHistoryViewModel(dto: AuditFindingHistoryDto): AuditFindingHistoryViewModel {
  return {
    fromStatus: toNullableStatus(dto.fromStatus),
    toStatus: toStatus(dto.toStatus),
    reason: dto.reason?.trim() || null,
    changedAt: dto.changedAt,
  };
}

function toSeverity(value: unknown): AuditFindingSeverity {
  return value === 'Critical' || value === 'High' || value === 'Medium' || value === 'Low'
    ? value
    : 'Low';
}

function toStatus(value: unknown): AuditFindingStatus {
  return value === 'Reviewing' ||
    value === 'Resolved' ||
    value === 'AcceptedRisk' ||
    value === 'FalsePositive'
    ? value
    : 'Open';
}

function toNullableStatus(value: unknown): AuditFindingStatus | null {
  return value == null ? null : toStatus(value);
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : 0;
}

function safePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
