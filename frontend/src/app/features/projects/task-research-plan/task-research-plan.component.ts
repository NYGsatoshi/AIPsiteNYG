import { HttpClient } from '@angular/common/http';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { normalizeApiError } from '../../../core/api/api-error.adapter';

type StepStatus = 'Planned' | 'Ready' | 'Blocked' | 'Deferred';

interface PlanStep {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly objective: string;
  readonly scopeSummary: string;
  readonly status: StepStatus;
}

interface PlanRevision {
  readonly id: string;
  readonly number: number;
  readonly createdAtUtc: string;
  readonly steps: readonly PlanStep[];
}

interface ResearchPlan {
  readonly planId: string | null;
  readonly version: number;
  readonly currentRevision: PlanRevision | null;
  readonly canManage: boolean;
}

interface EditableStep {
  readonly title: string;
  readonly objective: string;
  readonly scopeSummary: string;
  readonly status: StepStatus;
}

const EMPTY_STEP: EditableStep = Object.freeze({
  title: '',
  objective: '',
  scopeSummary: '',
  status: 'Planned'
});

/**
 * Editor for the current Task-owned Research Plan revision. Reordering uses
 * explicit move buttons so it remains available to keyboard and touch users.
 */
@Component({
  selector: 'app-task-research-plan',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './task-research-plan.component.html',
  styleUrl: './task-research-plan.component.scss'
})
export class TaskResearchPlanComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) taskId = '';
  @Output() readonly dirtyChange = new EventEmitter<boolean>();

  private readonly http = inject(HttpClient, { optional: true });
  private loadRequest: Subscription | null = null;
  private saveRequest: Subscription | null = null;
  private readonly generation = signal(0);
  private readonly state = signal<ResearchPlan | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly feedback = signal<string | null>(null);
  readonly draft = signal<EditableStep[]>([]);
  readonly loadedDraft = signal<EditableStep[]>([]);
  readonly plan = this.state.asReadonly();
  readonly canManage = computed(() => this.state()?.canManage ?? false);
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.loadedDraft()));
  readonly statuses: readonly StepStatus[] = ['Planned', 'Ready', 'Blocked', 'Deferred'];

  constructor() {
    effect(() => this.dirtyChange.emit(this.dirty()));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['taskId']) this.load();
  }

  ngOnDestroy(): void {
    this.generation.update(value => value + 1);
    this.loadRequest?.unsubscribe();
    this.saveRequest?.unsubscribe();
  }

  retry(): void { this.load(); }

  addStep(): void {
    if (!this.canManage() || this.saving()) return;
    this.draft.update(steps => [...steps, { ...EMPTY_STEP }]);
  }

  removeStep(index: number): void {
    if (!this.canManage() || this.saving()) return;
    this.draft.update(steps => steps.filter((_, candidate) => candidate !== index));
  }

  moveStep(index: number, direction: -1 | 1): void {
    if (!this.canManage() || this.saving()) return;
    const next = index + direction;
    this.draft.update(steps => {
      if (next < 0 || next >= steps.length) return steps;
      const reordered = [...steps];
      [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
      return reordered;
    });
  }

  updateText(index: number, field: 'title' | 'objective' | 'scopeSummary', value: string): void {
    if (!this.canManage() || this.saving()) return;
    this.draft.update(steps => steps.map((step, candidate) => candidate === index ? { ...step, [field]: value } : step));
  }

  updateStatus(index: number, value: string): void {
    if (!this.canManage() || this.saving() || !this.statuses.includes(value as StepStatus)) return;
    this.draft.update(steps => steps.map((step, candidate) => candidate === index ? { ...step, status: value as StepStatus } : step));
  }

  discard(): void {
    if (this.saving()) return;
    this.draft.set(copySteps(this.loadedDraft()));
    this.feedback.set('Unsaved Research Plan edits were discarded.');
  }

  save(): void {
    const http = this.http;
    const current = this.state();
    if (!http || !current || !current.canManage || this.saving() || !this.normalizedTaskId()) return;

    this.saving.set(true);
    this.error.set(null);
    this.feedback.set(null);
    const requestGeneration = this.generation();
    this.saveRequest?.unsubscribe();
    this.saveRequest = http.put<unknown>(
      `/api/tasks/${encodeURIComponent(this.normalizedTaskId())}/research-plan`,
      {
        expectedVersion: current.version,
        steps: this.draft().map(step => ({
          title: step.title,
          objective: step.objective,
          scopeSummary: step.scopeSummary,
          status: step.status
        }))
      },
      { withCredentials: true }).subscribe({
      next: response => {
        if (requestGeneration !== this.generation()) return;
        const plan = mapResearchPlan(response);
        if (!plan) {
          this.error.set('The saved Research Plan could not be read. Reload and try again.');
          return;
        }
        this.applyPlan(plan);
        this.feedback.set(`Research Plan revision ${plan.currentRevision?.number ?? ''} saved.`.trim());
      },
      error: error => {
        if (requestGeneration !== this.generation()) return;
        const apiError = normalizeApiError(error);
        this.error.set(apiError.message || 'The Research Plan could not be saved.');
        if (apiError.httpStatus === 409) this.load();
      },
      complete: () => {
        if (requestGeneration === this.generation()) this.saving.set(false);
      }
    });
  }

  private load(): void {
    const http = this.http;
    const taskId = this.normalizedTaskId();
    this.generation.update(value => value + 1);
    const requestGeneration = this.generation();
    this.loadRequest?.unsubscribe();
    this.saveRequest?.unsubscribe();
    this.saving.set(false);
    this.error.set(null);
    this.feedback.set(null);
    if (!http || !taskId) {
      this.loading.set(false);
      this.state.set(null);
      this.draft.set([]);
      this.loadedDraft.set([]);
      return;
    }

    this.loading.set(true);
    this.loadRequest = http.get<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/research-plan`,
      { withCredentials: true }).subscribe({
      next: response => {
        if (requestGeneration !== this.generation()) return;
        const plan = mapResearchPlan(response);
        if (!plan) {
          this.error.set('The Research Plan response was invalid.');
          return;
        }
        this.applyPlan(plan);
      },
      error: error => {
        if (requestGeneration !== this.generation()) return;
        this.state.set(null);
        this.draft.set([]);
        this.loadedDraft.set([]);
        this.error.set(normalizeApiError(error).message || 'The Research Plan could not be loaded.');
      },
      complete: () => {
        if (requestGeneration === this.generation()) this.loading.set(false);
      }
    });
  }

  private applyPlan(plan: ResearchPlan): void {
    const steps = (plan.currentRevision?.steps ?? []).map(step => ({
      title: step.title,
      objective: step.objective,
      scopeSummary: step.scopeSummary,
      status: step.status
    }));
    this.state.set(plan);
    this.draft.set(copySteps(steps));
    this.loadedDraft.set(copySteps(steps));
  }

  private normalizedTaskId(): string { return this.taskId.trim(); }
}

function copySteps(steps: readonly EditableStep[]): EditableStep[] {
  return steps.map(step => ({ ...step }));
}

function mapResearchPlan(value: unknown): ResearchPlan | null {
  if (!isRecord(value) || typeof value['version'] !== 'number' || typeof value['canManage'] !== 'boolean') return null;
  const revision = mapRevision(value['currentRevision']);
  if (value['currentRevision'] !== null && revision === null) return null;
  return {
    planId: typeof value['planId'] === 'string' ? value['planId'] : null,
    version: value['version'],
    currentRevision: revision,
    canManage: value['canManage']
  };
}

function mapRevision(value: unknown): PlanRevision | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['number'] !== 'number' || typeof value['createdAtUtc'] !== 'string' || !Array.isArray(value['steps'])) return null;
  const steps = value['steps'].map(mapStep);
  return steps.every((step): step is PlanStep => step !== null)
    ? { id: value['id'], number: value['number'], createdAtUtc: value['createdAtUtc'], steps }
    : null;
}

function mapStep(value: unknown): PlanStep | null {
  if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['position'] !== 'number' || typeof value['title'] !== 'string' || typeof value['objective'] !== 'string' || typeof value['scopeSummary'] !== 'string' || !isStepStatus(value['status'])) return null;
  return { id: value['id'], position: value['position'], title: value['title'], objective: value['objective'], scopeSummary: value['scopeSummary'], status: value['status'] };
}

function isStepStatus(value: unknown): value is StepStatus {
  return value === 'Planned' || value === 'Ready' || value === 'Blocked' || value === 'Deferred';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
