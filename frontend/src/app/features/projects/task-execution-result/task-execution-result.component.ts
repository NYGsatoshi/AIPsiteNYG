import { HttpClient } from '@angular/common/http';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { normalizeApiError } from '../../../core/api/api-error.adapter';

type RunStatus = 'Accepted' | 'Queued' | 'Running' | 'Succeeded' | 'Failed';

interface ExecutionRunAcceptance {
  readonly id: string;
  readonly status: RunStatus;
}

interface ExecutionReport {
  readonly id: string;
  readonly schemaVersion: number;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly contentSha256: string;
  readonly completedAtUtc: string;
}

interface ExecutionResultProjection {
  readonly runId: string;
  readonly status: RunStatus;
  readonly failureCode: string | null;
  readonly requestedAtUtc: string;
  readonly queuedAtUtc: string | null;
  readonly startedAtUtc: string | null;
  readonly finishedAtUtc: string | null;
  readonly report: ExecutionReport | null;
}

@Component({
  selector: 'app-task-execution-result',
  standalone: true,
  templateUrl: './task-execution-result.component.html',
  styleUrl: './task-execution-result.component.scss',
})
export class TaskExecutionResultComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) taskId = '';
  @Input() allowExecutionStart = false;
  @Input() loadExistingResult = true;

  private readonly http = inject(HttpClient, { optional: true });
  private request: Subscription | null = null;
  private startRequest: Subscription | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  readonly result = signal<ExecutionResultProjection | null>(null);
  readonly loading = signal(false);
  readonly noResult = signal(false);
  readonly error = signal<string | null>(null);
  readonly starting = signal(false);
  readonly startError = signal<string | null>(null);
  readonly startFeedback = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['taskId'] || changes['loadExistingResult']) {
      if (this.loadExistingResult) {
        this.reload();
      } else {
        this.resetWithoutLoad();
      }
    }
  }

  ngOnDestroy(): void {
    this.generation++;
    this.cancelPending();
  }

  retry(): void {
    this.reload();
  }

  startExecution(): void {
    const taskId = this.taskId.trim();
    const http = this.http;
    if (!this.allowExecutionStart || !taskId || !http || typeof http.post !== 'function' || this.starting()) {
      return;
    }

    this.generation++;
    const generation = this.generation;
    this.cancelPending();
    this.result.set(null);
    this.noResult.set(false);
    this.error.set(null);
    this.startError.set(null);
    this.startFeedback.set(null);
    this.starting.set(true);

    this.startRequest = http.post<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/execution-runs`,
      {},
      {
        headers: { 'Idempotency-Key': createExecutionIdempotencyKey() },
        withCredentials: true,
      },
    ).subscribe({
      next: (response) => {
        if (!this.isCurrent(generation, taskId)) {
          return;
        }

        let accepted: ExecutionRunAcceptance;
        try {
          accepted = mapExecutionRunAcceptance(response);
        } catch {
          this.startRequest = null;
          this.starting.set(false);
          this.startError.set('The execution acceptance response was invalid.');
          return;
        }

        this.startRequest = null;
        this.starting.set(false);
        this.startFeedback.set(startFeedbackMessage(accepted.status));
        this.load(generation);
      },
      error: (error: unknown) => {
        if (!this.isCurrent(generation, taskId)) {
          return;
        }

        this.startRequest = null;
        this.starting.set(false);
        const normalized = normalizeApiError(error);
        if (normalized.httpStatus === 401 || normalized.httpStatus === 403 || normalized.httpStatus === 404) {
          this.result.set(null);
          this.noResult.set(true);
          this.startError.set('Task execution is unavailable in the current session.');
          return;
        }

        this.startError.set(
          normalized.httpStatus === 409
            ? 'The execution request could not be reconciled. Start a new request.'
            : 'Task execution could not be started. Try again.',
        );
      },
    });
  }

  statusMessage(status: RunStatus): string {
    switch (status) {
      case 'Accepted': return 'The execution request was durably accepted.';
      case 'Queued': return 'The execution is queued for server processing.';
      case 'Running': return 'Authorized Project files are being analyzed.';
      case 'Succeeded': return 'The durable execution report is ready.';
      case 'Failed': return 'The execution ended with a safe failure state.';
    }
  }

  private reload(): void {
    this.generation++;
    const generation = this.generation;
    this.cancelPending();
    this.result.set(null);
    this.noResult.set(false);
    this.error.set(null);
    this.startError.set(null);
    this.load(generation);
  }

  private resetWithoutLoad(): void {
    this.generation++;
    this.cancelPending();
    this.result.set(null);
    this.noResult.set(false);
    this.error.set(null);
    this.startError.set(null);
    this.startFeedback.set(null);
  }

  private load(generation: number): void {
    const taskId = this.taskId.trim();
    const http = this.http;
    if (!taskId || !http || typeof http.get !== 'function') {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.request = http.get<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/execution-result`,
      { withCredentials: true },
    ).subscribe({
      next: (response) => {
        if (!this.isCurrent(generation, taskId)) {
          return;
        }

        try {
          const result = mapExecutionResult(response);
          this.result.set(result);
          this.noResult.set(false);
          this.error.set(null);
          this.loading.set(false);
          this.request = null;
          if (result.status === 'Accepted' || result.status === 'Queued' || result.status === 'Running') {
            this.pollTimer = setTimeout(() => this.load(generation), 1500);
          }
        } catch {
          this.loading.set(false);
          this.request = null;
          this.error.set('The execution result response was invalid.');
        }
      },
      error: (error: unknown) => {
        if (!this.isCurrent(generation, taskId)) {
          return;
        }

        this.loading.set(false);
        this.request = null;
        const normalized = normalizeApiError(error);
        if (normalized.httpStatus === 401 || normalized.httpStatus === 403 || normalized.httpStatus === 404) {
          this.result.set(null);
          this.error.set(null);
          this.noResult.set(true);
          return;
        }

        this.error.set('The execution result could not be loaded. Try again.');
      },
    });
  }

  private cancelPending(): void {
    this.request?.unsubscribe();
    this.startRequest?.unsubscribe();
    this.request = null;
    this.startRequest = null;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.loading.set(false);
    this.starting.set(false);
  }

  private isCurrent(generation: number, taskId: string): boolean {
    return generation === this.generation && taskId === this.taskId.trim();
  }
}

function mapExecutionRunAcceptance(value: unknown): ExecutionRunAcceptance {
  const record = requiredRecord(value, 'Task execution acceptance');
  return {
    id: requiredString(record['id'], 'Run identity'),
    status: requiredStatus(record['status']),
  };
}

function startFeedbackMessage(status: RunStatus): string {
  switch (status) {
    case 'Accepted': return 'Execution request accepted. The durable result will refresh from the server.';
    case 'Queued': return 'Execution queued. The durable result will refresh from the server.';
    case 'Running': return 'Execution started. The durable result will refresh from the server.';
    case 'Succeeded': return 'Execution completed. The durable report is loading from the server.';
    case 'Failed': return 'Execution completed with a bounded server failure state.';
  }
}

function createExecutionIdempotencyKey(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `task-execution-ui-${randomId}`;
}

function mapExecutionResult(value: unknown): ExecutionResultProjection {
  const record = requiredRecord(value, 'Task execution result');
  const status = requiredStatus(record['status']);
  const report = nullableReport(record['report']);
  if (status === 'Succeeded' && report === null) {
    throw new Error('A succeeded execution requires a durable report.');
  }
  if (status !== 'Succeeded' && report !== null) {
    throw new Error('A non-succeeded execution cannot expose a report.');
  }

  return {
    runId: requiredString(record['runId'], 'Run identity'),
    status,
    failureCode: nullableString(record['failureCode'], 'Failure code', 100),
    requestedAtUtc: requiredString(record['requestedAtUtc'], 'Requested timestamp'),
    queuedAtUtc: nullableString(record['queuedAtUtc'], 'Queued timestamp'),
    startedAtUtc: nullableString(record['startedAtUtc'], 'Started timestamp'),
    finishedAtUtc: nullableString(record['finishedAtUtc'], 'Finished timestamp'),
    report,
  };
}

function nullableReport(value: unknown): ExecutionReport | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requiredRecord(value, 'Task execution report');
  const schemaVersion = record['schemaVersion'];
  if (schemaVersion !== 1) {
    throw new Error('Task execution report schema is unsupported.');
  }

  const contentSha256 = requiredString(record['contentSha256'], 'Report hash', 64);
  if (!/^[0-9a-f]{64}$/.test(contentSha256)) {
    throw new Error('Task execution report hash is invalid.');
  }

  return {
    id: requiredString(record['id'], 'Report identity'),
    schemaVersion,
    title: requiredString(record['title'], 'Report title', 200),
    bodyMarkdown: requiredString(record['bodyMarkdown'], 'Report body', 20_000),
    contentSha256,
    completedAtUtc: requiredString(record['completedAtUtc'], 'Report completion timestamp'),
  };
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requiredStatus(value: unknown): RunStatus {
  if (value === 'Accepted' || value === 'Queued' || value === 'Running' || value === 'Succeeded' || value === 'Failed') {
    return value;
  }
  throw new Error('Task execution status is invalid.');
}

function requiredString(value: unknown, label: string, maximumLength = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nullableString(value: unknown, label: string, maximumLength = 200): string | null {
  return value === null || value === undefined ? null : requiredString(value, label, maximumLength);
}