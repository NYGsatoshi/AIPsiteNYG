import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { AuditFindingsFacade } from './audit-findings.facade';
import {
  AuditFindingFilters,
  AuditFindingSeverity,
  AuditFindingStatus,
  AuditFindingViewModel,
} from './audit-findings.types';

@Component({
  selector: 'app-audit-findings-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './audit-findings-page.component.html',
  styleUrl: './audit-findings-page.component.scss',
})
export class AuditFindingsPageComponent {
  private readonly facade = inject(AuditFindingsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly routeState = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => ({
        artifactVersionId: params.get('artifactVersion'),
        status: normalizeStatus(params.get('status')),
        severity: normalizeSeverity(params.get('severity')),
        openOnly: params.get('openOnly') === 'true',
      })),
      distinctUntilChanged((left, right) =>
        left.artifactVersionId === right.artifactVersionId &&
        left.status === right.status &&
        left.severity === right.severity &&
        left.openOnly === right.openOnly,
      ),
    ),
    {
      initialValue: {
        artifactVersionId: this.route.snapshot.queryParamMap.get('artifactVersion'),
        status: normalizeStatus(this.route.snapshot.queryParamMap.get('status')),
        severity: normalizeSeverity(this.route.snapshot.queryParamMap.get('severity')),
        openOnly: this.route.snapshot.queryParamMap.get('openOnly') === 'true',
      },
    },
  );

  readonly vm = this.facade.viewModel;
  readonly saving = this.facade.saving;
  readonly mutationError = this.facade.mutationError;
  readonly versionInput = signal(this.route.snapshot.queryParamMap.get('artifactVersion') ?? '');
  readonly inputError = signal<string | null>(null);
  readonly selectedFindingId = signal<string | null>(null);
  readonly selectedOwnerUserId = signal('');
  readonly reason = signal('');
  readonly reasonError = signal<string | null>(null);

  readonly statuses: readonly AuditFindingStatus[] = [
    'Open',
    'Reviewing',
    'Resolved',
    'AcceptedRisk',
    'FalsePositive',
  ];
  readonly severities: readonly AuditFindingSeverity[] = ['Critical', 'High', 'Medium', 'Low'];

  readonly filters = computed<AuditFindingFilters>(() => {
    const state = this.routeState();
    return {
      status: state.status,
      severity: state.severity,
      openOnly: state.openOnly,
    };
  });

  readonly selectedFinding = computed(() => {
    const id = this.selectedFindingId();
    return this.vm().findings.find((finding) => finding.id === id) ?? null;
  });

  readonly unresolvedCount = computed(() =>
    this.vm().findings.filter((finding) => finding.status === 'Open' || finding.status === 'Reviewing').length,
  );

  constructor() {
    effect(() => {
      const state = this.routeState();
      untracked(() => this.loadFromRoute(state.artifactVersionId, {
        status: state.status,
        severity: state.severity,
        openOnly: state.openOnly,
      }));
    });

    effect(() => {
      const page = this.vm();
      if (page.status !== 'ready' || page.findings.length === 0) {
        untracked(() => this.clearSelection());
        return;
      }

      untracked(() => {
        const existing = page.findings.find((finding) => finding.id === this.selectedFindingId());
        this.selectFinding(existing ?? page.findings[0]);
      });
    });
  }

  updateVersionInput(value: string): void {
    this.versionInput.set(value);
    if (this.inputError()) {
      this.inputError.set(null);
    }
  }

  openVersion(): void {
    const versionId = this.versionInput().trim();
    if (!isGuid(versionId)) {
      this.inputError.set('Enter a valid artifact version ID.');
      return;
    }

    this.inputError.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { artifactVersion: versionId },
      queryParamsHandling: 'merge',
    });
  }

  updateStatus(value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status: normalizeStatus(value) || null },
      queryParamsHandling: 'merge',
    });
  }

  updateSeverity(value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { severity: normalizeSeverity(value) || null },
      queryParamsHandling: 'merge',
    });
  }

  toggleOpenOnly(checked: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { openOnly: checked ? 'true' : null },
      queryParamsHandling: 'merge',
    });
  }

  clearFilters(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status: null, severity: null, openOnly: null },
      queryParamsHandling: 'merge',
    });
  }

  selectFinding(finding: AuditFindingViewModel): void {
    if (!this.vm().findings.some((candidate) => candidate.id === finding.id)) {
      return;
    }

    this.selectedFindingId.set(finding.id);
    this.selectedOwnerUserId.set(finding.ownerUserId ?? '');
    this.reason.set(finding.resolutionReason ?? '');
    this.reasonError.set(null);
  }

  updateOwner(value: string): void {
    this.selectedOwnerUserId.set(value.trim());
  }

  saveOwner(): void {
    const finding = this.selectedFinding();
    if (!finding || !this.vm().canReview || this.saving()) {
      return;
    }

    const ownerUserId = this.selectedOwnerUserId() || null;
    if (ownerUserId === finding.ownerUserId) {
      return;
    }

    this.facade.updateTriage(finding.id, finding.status, null, ownerUserId, true);
  }

  updateReason(value: string): void {
    this.reason.set(value);
    if (this.reasonError()) {
      this.reasonError.set(null);
    }
  }

  transition(status: AuditFindingStatus): void {
    const finding = this.selectedFinding();
    if (!finding || !this.vm().canReview || this.saving()) {
      return;
    }

    const reason = this.reason().trim();
    if ((status === 'AcceptedRisk' || status === 'FalsePositive') && !reason) {
      this.reasonError.set('A reason is required for Accepted Risk or False Positive.');
      return;
    }

    this.reasonError.set(null);
    this.facade.updateTriage(finding.id, status, reason || null);
  }

  statusLabel(status: AuditFindingStatus): string {
    switch (status) {
      case 'AcceptedRisk': return 'Accepted Risk';
      case 'FalsePositive': return 'False Positive';
      default: return status;
    }
  }

  formatTimestamp(value: string | null): string {
    if (!value) {
      return '—';
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  private loadFromRoute(artifactVersionId: string | null, filters: AuditFindingFilters): void {
    this.clearSelection();
    this.versionInput.set(artifactVersionId ?? '');

    if (!artifactVersionId) {
      this.inputError.set(null);
      this.facade.clear();
      return;
    }

    if (!isGuid(artifactVersionId)) {
      this.inputError.set('Enter a valid artifact version ID.');
      this.facade.clear();
      return;
    }

    this.inputError.set(null);
    this.facade.load(artifactVersionId, filters);
  }

  private clearSelection(): void {
    this.selectedFindingId.set(null);
    this.selectedOwnerUserId.set('');
    this.reason.set('');
    this.reasonError.set(null);
  }
}

function normalizeStatus(value: string | null): AuditFindingStatus | '' {
  return value === 'Open' ||
    value === 'Reviewing' ||
    value === 'Resolved' ||
    value === 'AcceptedRisk' ||
    value === 'FalsePositive'
    ? value
    : '';
}

function normalizeSeverity(value: string | null): AuditFindingSeverity | '' {
  return value === 'Critical' || value === 'High' || value === 'Medium' || value === 'Low'
    ? value
    : '';
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
