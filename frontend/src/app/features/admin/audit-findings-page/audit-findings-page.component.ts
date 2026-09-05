import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { AuditFindingDecisionPanelComponent } from './audit-finding-decision-panel.component';
import { AuditFindingsFacade } from './audit-findings.facade';
import {
  AuditFindingFilters,
  AuditFindingSeverity,
  AuditFindingStatus,
  AuditFindingViewModel,
  AuditFindingWorkflowStatus,
} from './audit-findings.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-audit-findings-page',
  standalone: true,
  imports: [RouterLink, AuditFindingDecisionPanelComponent],
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
        workflowStatus: normalizeWorkflowStatus(params.get('workflowStatus')),
        myReviews: params.get('myReviews') === 'true',
        overdue: params.get('overdue') === 'true',
        unassigned: params.get('unassigned') === 'true',
      })),
      distinctUntilChanged((left, right) =>
        left.artifactVersionId === right.artifactVersionId &&
        left.status === right.status &&
        left.severity === right.severity &&
        left.openOnly === right.openOnly &&
        left.workflowStatus === right.workflowStatus &&
        left.myReviews === right.myReviews &&
        left.overdue === right.overdue &&
        left.unassigned === right.unassigned,
      ),
    ),
    {
      initialValue: {
        artifactVersionId: this.route.snapshot.queryParamMap.get('artifactVersion'),
        status: normalizeStatus(this.route.snapshot.queryParamMap.get('status')),
        severity: normalizeSeverity(this.route.snapshot.queryParamMap.get('severity')),
        openOnly: this.route.snapshot.queryParamMap.get('openOnly') === 'true',
        workflowStatus: normalizeWorkflowStatus(this.route.snapshot.queryParamMap.get('workflowStatus')),
        myReviews: this.route.snapshot.queryParamMap.get('myReviews') === 'true',
        overdue: this.route.snapshot.queryParamMap.get('overdue') === 'true',
        unassigned: this.route.snapshot.queryParamMap.get('unassigned') === 'true',
      },
    },
  );

  readonly vm = this.facade.viewModel;
  readonly saving = this.facade.saving;
  readonly mutationError = this.facade.mutationError;
  readonly mutationNotice = this.facade.mutationNotice;
  readonly versionInput = signal(this.route.snapshot.queryParamMap.get('artifactVersion') ?? '');
  readonly inputError = signal<string | null>(null);
  readonly selectedFindingId = signal<string | null>(null);
  readonly selectedOwnerUserId = signal('');
  readonly selectedWorkflowStatus = signal<AuditFindingWorkflowStatus>('Open');
  readonly selectedDueDate = signal('');
  readonly reason = signal('');
  readonly reasonError = signal<string | null>(null);

  readonly statuses: readonly AuditFindingStatus[] = [
    'Open',
    'Reviewing',
    'Resolved',
    'AcceptedRisk',
    'FalsePositive',
  ];
  readonly workflowStatuses: readonly AuditFindingWorkflowStatus[] = [
    'Open',
    'InReview',
    'WaitingFix',
    'ReadyForReReview',
    'Done',
  ];
  readonly severities: readonly AuditFindingSeverity[] = ['Critical', 'High', 'Medium', 'Low'];

  readonly filters = computed<AuditFindingFilters>(() => {
    const state = this.routeState();
    return {
      status: state.status,
      severity: state.severity,
      openOnly: state.openOnly,
      workflowStatus: state.workflowStatus,
      myReviews: state.myReviews,
      overdue: state.overdue,
      unassigned: state.unassigned,
    };
  });

  readonly selectedFinding = computed(() => {
    const id = this.selectedFindingId();
    return this.vm().findings.find((finding) => finding.id === id) ?? null;
  });

  readonly unresolvedCount = computed(() =>
    this.vm().findings.filter((finding) => finding.status === 'Open' || finding.status === 'Reviewing').length,
  );

  readonly overdueCount = computed(() =>
    this.vm().findings.filter((finding) => finding.isOverdue).length,
  );

  constructor() {
    effect(() => {
      const state = this.routeState();
      untracked(() => this.loadFromRoute(state.artifactVersionId, {
        status: state.status,
        severity: state.severity,
        openOnly: state.openOnly,
        workflowStatus: state.workflowStatus,
        myReviews: state.myReviews,
        overdue: state.overdue,
        unassigned: state.unassigned,
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

  updateWorkflowStatusFilter(value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { workflowStatus: normalizeWorkflowStatus(value) || null },
      queryParamsHandling: 'merge',
    });
  }

  toggleMyReviews(checked: boolean): void {
    this.updateBooleanFilter('myReviews', checked);
  }

  toggleOverdue(checked: boolean): void {
    this.updateBooleanFilter('overdue', checked);
  }

  toggleUnassigned(checked: boolean): void {
    this.updateBooleanFilter('unassigned', checked);
  }

  clearFilters(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        status: null,
        severity: null,
        openOnly: null,
        workflowStatus: null,
        myReviews: null,
        overdue: null,
        unassigned: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  selectFinding(finding: AuditFindingViewModel): void {
    if (!this.vm().findings.some((candidate) => candidate.id === finding.id)) {
      return;
    }

    this.selectedFindingId.set(finding.id);
    this.selectedOwnerUserId.set(finding.ownerUserId ?? '');
    this.selectedWorkflowStatus.set(finding.workflowStatus);
    this.selectedDueDate.set(finding.dueDate ?? '');
    this.reason.set(finding.resolutionReason ?? '');
    this.reasonError.set(null);
  }

  updateOwner(value: string): void {
    this.selectedOwnerUserId.set(value.trim());
  }

  updateWorkflowStatus(value: string): void {
    this.selectedWorkflowStatus.set(normalizeWorkflowStatus(value) || 'Open');
  }

  updateDueDate(value: string): void {
    this.selectedDueDate.set(value.trim());
  }

  saveWorkflow(): void {
    const finding = this.selectedFinding();
    if (!finding || !this.vm().canReview || this.saving()) {
      return;
    }

    const ownerUserId = this.selectedOwnerUserId() || null;
    const dueDate = this.selectedDueDate() || null;
    const workflowStatus = this.selectedWorkflowStatus();
    if (
      ownerUserId === finding.ownerUserId &&
      dueDate === finding.dueDate &&
      workflowStatus === finding.workflowStatus
    ) {
      return;
    }

    this.facade.updateWorkflow(finding.id, workflowStatus, ownerUserId, dueDate);
  }

  mentionSelectedReviewer(): void {
    const finding = this.selectedFinding();
    const reviewerUserId = this.selectedOwnerUserId();
    if (!finding || !this.vm().canReview || this.saving() || !reviewerUserId) {
      return;
    }

    this.facade.mentionReviewer(finding.id, reviewerUserId);
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

  workflowStatusLabel(status: AuditFindingWorkflowStatus): string {
    switch (status) {
      case 'InReview': return 'In Review';
      case 'WaitingFix': return 'Waiting Fix';
      case 'ReadyForReReview': return 'Ready for Re-review';
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

  formatDueDate(value: string | null): string {
    return value || 'No due date';
  }

  ownerLabel(displayName: string | null): string {
    return displayName || 'Unassigned';
  }

  private updateBooleanFilter(name: 'myReviews' | 'overdue' | 'unassigned', checked: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [name]: checked ? 'true' : null },
      queryParamsHandling: 'merge',
    });
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
    this.selectedWorkflowStatus.set('Open');
    this.selectedDueDate.set('');
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

function normalizeWorkflowStatus(value: string | null): AuditFindingWorkflowStatus | '' {
  return value === 'Open' ||
    value === 'InReview' ||
    value === 'WaitingFix' ||
    value === 'ReadyForReReview' ||
    value === 'Done'
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
