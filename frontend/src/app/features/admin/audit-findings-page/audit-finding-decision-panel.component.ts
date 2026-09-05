import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

export type AuditFindingDecision = 'NoIssue' | 'NeedsFix' | 'AcceptedRisk';

interface AuditFindingDecisionOptionDto {
  readonly decision: AuditFindingDecision;
  readonly label: string;
  readonly rationaleRequired: boolean;
}

interface AuditFindingDecisionHistoryDto {
  readonly decisionId: string;
  readonly decision: AuditFindingDecision;
  readonly previousDecision: AuditFindingDecision | null;
  readonly rationale: string | null;
  readonly reviewerUserId: string;
  readonly reviewerDisplayName: string;
  readonly timestamp: string;
}

interface AuditFindingDecisionResponseDto {
  readonly findingId: string;
  readonly reviewCompleted: boolean;
  readonly canReview: boolean;
  readonly currentDecision: AuditFindingDecisionHistoryDto | null;
  readonly history: readonly AuditFindingDecisionHistoryDto[];
  readonly options: readonly AuditFindingDecisionOptionDto[];
}

type PanelState =
  | { readonly status: 'loading'; readonly response: null; readonly message?: string }
  | { readonly status: 'ready'; readonly response: AuditFindingDecisionResponseDto; readonly message?: string }
  | { readonly status: 'permissionDenied' | 'notFound' | 'error'; readonly response: null; readonly message: string };

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-audit-finding-decision-panel',
  standalone: true,
  templateUrl: './audit-finding-decision-panel.component.html',
  styleUrl: './audit-finding-decision-panel.component.scss',
})
export class AuditFindingDecisionPanelComponent {
  public readonly saveAnnouncement = signal('');
  public readonly readyStatusMessage = computed(() => {
    const announcement = this.saveAnnouncement(), panel = this.state();
    if (announcement !== '') {
      return announcement;
    }
    if (panel.status === 'ready' && panel.response.reviewCompleted) {
      return 'A structured decision is recorded.';
    }
    return 'No structured decision is recorded yet.';
  });

  private readonly http = inject(HttpClient);
  private requestVersion = 0;

  readonly findingId = input.required<string>();
  readonly state = signal<PanelState>({ status: 'loading', response: null });
  readonly selectedDecision = signal<AuditFindingDecision | ''>('');
  readonly rationale = signal('');
  readonly saving = signal(false);
  readonly validationError = signal<string | null>(null);
  readonly mutationError = signal<string | null>(null);

  readonly selectedOption = computed(() => {
    const response = this.state().response;
    const selected = this.selectedDecision();
    return response?.options.find((option) => option.decision === selected) ?? null;
  });

  constructor() {
    effect(() => {
      const findingId = this.findingId();
      untracked(() => this.load(findingId));
    });
  }

  updateDecision(value: string): void {
    this.selectedDecision.set(isDecision(value) ? value : '');
    this.validationError.set(null);
    this.mutationError.set(null);
    this.saveAnnouncement.set('');
  }

  updateRationale(value: string): void {
    this.rationale.set(value);
    this.validationError.set(null);
    this.mutationError.set(null);
    this.saveAnnouncement.set('');
  }

  save(): void {
    const panel = this.state();
    const decision = this.selectedDecision();
    if (panel.status !== 'ready' || !panel.response.canReview || !decision || this.saving()) {
      return;
    }

    const option = panel.response.options.find((candidate) => candidate.decision === decision);
    if (!option) {
      this.validationError.set('Select a valid structured decision.');
      return;
    }

    const rationale = this.rationale().trim();
    if (option.rationaleRequired && !rationale) {
      this.validationError.set(`${option.label} requires a rationale.`);
      return;
    }

    this.validationError.set(null);
    this.mutationError.set(null);
    this.saveAnnouncement.set('Saving structured decision.');
    this.saving.set(true);
    const requestVersion = this.requestVersion;
    this.http
      .put<AuditFindingDecisionResponseDto>(
        `/api/admin/audit/findings/${encodeURIComponent(this.findingId())}/decision`,
        { decision, rationale: rationale || null },
        { withCredentials: true },
      )
      .subscribe({
        next: (response) => {
          if (requestVersion !== this.requestVersion) {
            return;
          }
          this.saving.set(false);
          this.applyResponse(response);
          const savedState = this.state();
          if (savedState.status === 'ready' && savedState.response.reviewCompleted) {
            this.saveAnnouncement.set('Structured decision saved. Review complete.');
          } else {
            this.saveAnnouncement.set('Structured decision saved.');
          }
        },
        error: (error: { status?: number }) => {
          if (requestVersion !== this.requestVersion) {
            return;
          }
          this.saving.set(false);
          this.saveAnnouncement.set('');
          this.mutationError.set(
            error.status === 401 || error.status === 403
              ? 'Audit review permission is required to save a structured decision.'
              : error.status === 404
                ? 'The finding is no longer available in the current authorized scope.'
                : error.status === 400
                  ? 'The structured decision was rejected. Check the decision and rationale.'
                  : 'The structured decision could not be saved.',
          );
        },
      });
  }

  decisionLabel(decision: AuditFindingDecision | null): string {
    if (!decision) {
      return 'None';
    }

    const response = this.state().response;
    return response?.options.find((option) => option.decision === decision)?.label ?? fallbackLabel(decision);
  }

  formatTimestamp(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  private load(findingId: string): void {
    const normalized = findingId.trim();
    const requestVersion = ++this.requestVersion;
    this.state.set({ status: 'loading', response: null });
    this.selectedDecision.set('');
    this.rationale.set('');
    this.validationError.set(null);
    this.mutationError.set(null);
    this.saveAnnouncement.set('');
    this.saving.set(false);

    this.http
      .get<AuditFindingDecisionResponseDto>(
        `/api/admin/audit/findings/${encodeURIComponent(normalized)}/decision`,
        { withCredentials: true },
      )
      .subscribe({
        next: (response) => {
          if (requestVersion !== this.requestVersion) {
            return;
          }
          this.applyResponse(response);
        },
        error: (error: { status?: number }) => {
          if (requestVersion !== this.requestVersion) {
            return;
          }

          if (error.status === 401 || error.status === 403) {
            this.state.set({
              status: 'permissionDenied',
              response: null,
              message: 'The structured decision is unavailable without current Audit view permission.',
            });
            return;
          }
          if (error.status === 404) {
            this.state.set({
              status: 'notFound',
              response: null,
              message: 'The structured decision is unavailable in the current authorized scope.',
            });
            return;
          }

          this.state.set({
            status: 'error',
            response: null,
            message: 'The structured decision could not be loaded.',
          });
        },
      });
  }

  private applyResponse(response: AuditFindingDecisionResponseDto): void {
    const normalized = normalizeResponse(response);
    this.state.set({ status: 'ready', response: normalized });
    this.selectedDecision.set(
      normalized.currentDecision?.decision ?? normalized.options[0]?.decision ?? '',
    );
    this.rationale.set(normalized.currentDecision?.rationale ?? '');
    this.validationError.set(null);
    this.mutationError.set(null);
  }
}

function normalizeResponse(response: AuditFindingDecisionResponseDto): AuditFindingDecisionResponseDto {
  const options = (response.options ?? []).filter(
    (option): option is AuditFindingDecisionOptionDto => isDecision(option.decision),
  );
  const history = (response.history ?? []).filter(
    (entry): entry is AuditFindingDecisionHistoryDto => isDecision(entry.decision),
  );
  const current = response.currentDecision && isDecision(response.currentDecision.decision)
    ? response.currentDecision
    : null;

  return {
    findingId: response.findingId,
    reviewCompleted: current !== null && response.reviewCompleted === true,
    canReview: response.canReview === true,
    currentDecision: current,
    history,
    options,
  };
}

function isDecision(value: unknown): value is AuditFindingDecision {
  return value === 'NoIssue' || value === 'NeedsFix' || value === 'AcceptedRisk';
}

function fallbackLabel(decision: AuditFindingDecision): string {
  switch (decision) {
    case 'NoIssue': return 'No issue';
    case 'NeedsFix': return 'Needs fix';
    case 'AcceptedRisk': return 'Accepted risk';
  }
}
