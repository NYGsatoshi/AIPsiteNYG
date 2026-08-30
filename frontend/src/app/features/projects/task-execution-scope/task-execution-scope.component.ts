import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, computed, inject, signal, viewChild } from '@angular/core';
import { forkJoin, Subscription } from 'rxjs';

import { normalizeApiError } from '../../../core/api/api-error.adapter';
import { RealtimeFacade } from '../../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../../core/realtime/realtime.models';
import { AIP_PROJECTS_MOCK } from '../projects.facade';

type ScopeOrigin = 'ProjectDefault' | 'TaskOverride';
type ScopeEditorMode = 'inherit' | 'override';
type RunStatus = 'Accepted' | 'Queued' | 'Running' | 'Succeeded' | 'Failed';
type MajorState = 'Accepted' | 'Queued' | 'Running' | 'Succeeded' | 'Failed';

interface SourcePolicy {
  readonly webEnabled: boolean;
  readonly projectFilesEnabled: boolean;
}

interface ProjectExecutionScope {
  readonly policy: SourcePolicy;
  readonly version: number;
  readonly canManage: boolean;
}

interface LatestExecutionRun {
  readonly status: RunStatus;
  readonly majorState: MajorState;
  readonly snapshotScopeOrigin: ScopeOrigin;
  readonly snapshotWebEnabled: boolean;
  readonly snapshotProjectFilesEnabled: boolean;
}

interface TaskExecutionScope {
  readonly effectivePolicy: SourcePolicy;
  readonly origin: ScopeOrigin;
  readonly projectDefaultVersion: number;
  readonly taskOverrideVersion: number | null;
  readonly taskOverridePolicy: SourcePolicy | null;
  readonly canManage: boolean;
  readonly latestRun: LatestExecutionRun | null;
}

interface ScopePanelData {
  readonly projectId: string;
  readonly taskId: string;
  readonly project: ProjectExecutionScope;
  readonly task: TaskExecutionScope;
}

const MOCK_POLICY: SourcePolicy = Object.freeze({ webEnabled: false, projectFilesEnabled: false });
let componentSequence = 0;

/**
 * A deliberately small policy editor. It only displays server-authorized
 * booleans and version tokens; it has no source inventory, URL, file, or
 * execution-provider capability.
 */
@Component({
  selector: 'app-task-execution-scope',
  standalone: true,
  templateUrl: './task-execution-scope.component.html',
  styleUrl: './task-execution-scope.component.scss',
})
export class TaskExecutionScopeComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) projectId = '';
  @Input({ required: true }) taskId = '';

  private readonly http = inject(HttpClient, { optional: true });
  private readonly realtime = inject(RealtimeFacade, { optional: true });
  private readonly scenario = inject(AIP_PROJECTS_MOCK, { optional: true });
  private readonly owner = `task-execution-scope-${++componentSequence}`;
  private readonly feedbackElement = viewChild<ElementRef<HTMLElement>>('scopeFeedback');
  private readonly detailsElement = viewChild<ElementRef<HTMLElement>>('scopeDetails');
  private readonly state = signal<ScopePanelData | null>(null);
  private readonly scopeGeneration = signal(0);
  readonly activeRead = signal(false);
  private readRequest: Subscription | null = null;
  private mutationRequest: Subscription | null = null;
  private realtimeEvents: Subscription | null = null;
  private unregisterProtectedStateClearer: (() => void) | null = null;

  readonly loadError = signal<string | null>(null);
  readonly mutationError = signal<string | null>(null);
  readonly feedback = signal<string | null>(null);
  readonly saving = signal<'project' | 'task' | null>(null);
  readonly projectWebEnabled = signal(false);
  readonly projectFilesEnabled = signal(false);
  readonly taskEditorMode = signal<ScopeEditorMode>('inherit');
  readonly overrideWebEnabled = signal(false);
  readonly overrideProjectFilesEnabled = signal(false);

  readonly scope = this.state.asReadonly();
  readonly canManageProject = computed(() => this.state()?.project.canManage ?? false);
  readonly canManageTask = computed(() => this.state()?.task.canManage ?? false);
  readonly canManageAnything = computed(() => this.canManageProject() || this.canManageTask());
  readonly allowedSourceKindCount = computed(() => {
    const policy = this.state()?.task.effectivePolicy;
    if (!policy) {
      return 0;
    }

    return Number(policy.webEnabled) + Number(policy.projectFilesEnabled);
  });
  readonly detailsId = `${this.owner}-details`;

  constructor() {
    this.unregisterProtectedStateClearer = this.realtime?.registerProtectedStateClearer(
      this.owner,
      () => this.clearProtectedState(),
    ) ?? null;
    this.realtimeEvents = this.realtime?.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event)) ?? null;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['projectId'] || changes['taskId']) {
      this.loadScope();
    }
  }

  ngOnDestroy(): void {
    this.scopeGeneration.update((generation) => generation + 1);
    this.readRequest?.unsubscribe();
    this.mutationRequest?.unsubscribe();
    this.realtimeEvents?.unsubscribe();
    this.unregisterProtectedStateClearer?.();
  }

  retry(): void {
    this.loadScope();
  }

  focusScopeDetails(): void {
    const details = this.detailsElement()?.nativeElement;
    if (!details) {
      return;
    }

    details.focus({ preventScroll: true });
    details.scrollIntoView?.({ block: 'nearest' });
  }

  setProjectWebEnabled(event: Event): void {
    this.projectWebEnabled.set(checkboxValue(event));
  }

  setProjectFilesEnabled(event: Event): void {
    this.projectFilesEnabled.set(checkboxValue(event));
  }

  setTaskEditorMode(mode: ScopeEditorMode): void {
    this.taskEditorMode.set(mode);
  }

  setOverrideWebEnabled(event: Event): void {
    this.overrideWebEnabled.set(checkboxValue(event));
  }

  setOverrideProjectFilesEnabled(event: Event): void {
    this.overrideProjectFilesEnabled.set(checkboxValue(event));
  }

  saveProjectDefault(): void {
    const current = this.state();
    const http = this.http;
    if (!current || !current.project.canManage || !http || typeof http.put !== 'function' || this.saving()) {
      return;
    }

    const projectId = this.normalizedProjectId();
    const taskId = this.normalizedTaskId();
    if (!projectId || !taskId) {
      return;
    }

    const generation = this.scopeGeneration();
    this.mutationRequest?.unsubscribe();
    this.saving.set('project');
    this.mutationError.set(null);
    this.feedback.set(null);
    this.mutationRequest = http.put<unknown>(
      `/api/projects/${encodeURIComponent(projectId)}/execution-scope`,
      {
        webEnabled: this.projectWebEnabled(),
        projectFilesEnabled: this.projectFilesEnabled(),
        expectedVersion: current.project.version,
      },
      { withCredentials: true },
    ).subscribe({
      next: (response) => {
        try {
          mapProjectExecutionScope(response);
        } catch (error: unknown) {
          this.completeMutationFailure(error, generation, projectId, taskId);
          return;
        }

        if (!this.isCurrent(generation, projectId, taskId)) {
          return;
        }

        this.mutationRequest = null;
        this.saving.set(null);
        this.feedback.set('Project default source settings saved. The Task summary was refreshed from the server.');
        this.focusFeedbackSoon();
        this.loadScope(true);
      },
      error: (error: unknown) => this.completeMutationFailure(error, generation, projectId, taskId),
    });
  }

  saveTaskScope(): void {
    const current = this.state();
    const http = this.http;
    if (!current || !current.task.canManage || !http || this.saving()) {
      return;
    }

    const projectId = this.normalizedProjectId();
    const taskId = this.normalizedTaskId();
    if (!projectId || !taskId) {
      return;
    }

    const generation = this.scopeGeneration();
    const mode = this.taskEditorMode();
    const request = mode === 'inherit'
      ? http.delete<unknown>(
        `/api/tasks/${encodeURIComponent(taskId)}/execution-scope-override`,
        {
          body: { expectedVersion: current.task.taskOverrideVersion ?? 0 },
          withCredentials: true,
        },
      )
      : http.put<unknown>(
        `/api/tasks/${encodeURIComponent(taskId)}/execution-scope-override`,
        {
          webEnabled: this.overrideWebEnabled(),
          projectFilesEnabled: this.overrideProjectFilesEnabled(),
          expectedVersion: current.task.taskOverrideVersion ?? 0,
        },
        { withCredentials: true },
      );

    this.mutationRequest?.unsubscribe();
    this.saving.set('task');
    this.mutationError.set(null);
    this.feedback.set(null);
    this.mutationRequest = request.subscribe({
      next: (response) => {
        try {
          mapTaskExecutionScope(response);
        } catch (error: unknown) {
          this.completeMutationFailure(error, generation, projectId, taskId);
          return;
        }

        if (!this.isCurrent(generation, projectId, taskId)) {
          return;
        }

        this.mutationRequest = null;
        this.saving.set(null);
        this.feedback.set(
          mode === 'inherit'
            ? 'This Task now inherits the Project default source settings.'
            : 'Task source settings saved as a complete Task override.',
        );
        this.focusFeedbackSoon();
        this.loadScope(true);
      },
      error: (error: unknown) => this.completeMutationFailure(error, generation, projectId, taskId),
    });
  }

  sourceEligibility(enabled: boolean): string {
    return enabled
      ? 'Enabled for a future approved runtime'
      : 'Disabled';
  }

  scopeOriginLabel(origin: ScopeOrigin): string {
    return origin === 'TaskOverride' ? 'Task override' : 'Project default';
  }

  majorStateLabel(state: MajorState): string {
    return state;
  }

  runStatusLabel(status: RunStatus): string {
    switch (status) {
      case 'Accepted': return 'Execution request was durably accepted.';
      case 'Queued': return 'Execution is queued for server materialization.';
      case 'Running': return 'Execution is materializing and analyzing authorized Project files.';
      case 'Succeeded': return 'Execution succeeded.';
      case 'Failed': return 'Execution failed.';
      default: return 'Execution state unavailable.';
    }
  }

  private loadScope(preserveFeedback = false): void {
    const projectId = this.normalizedProjectId();
    const taskId = this.normalizedTaskId();
    this.scopeGeneration.update((generation) => generation + 1);
    const generation = this.scopeGeneration();
    this.readRequest?.unsubscribe();
    this.mutationRequest?.unsubscribe();
    this.mutationRequest = null;
    this.saving.set(null);
    if (!preserveFeedback) {
      this.feedback.set(null);
    }
    this.mutationError.set(null);
    this.loadError.set(null);
    const current = this.state();
    if (!current || current.projectId !== projectId || current.taskId !== taskId) {
      this.state.set(null);
    }

    if (!projectId || !taskId) {
      this.activeRead.set(false);
      return;
    }

    if (this.scenario) {
      this.applyScope(
        { policy: MOCK_POLICY, version: 1, canManage: false },
        {
          effectivePolicy: MOCK_POLICY,
          origin: 'ProjectDefault',
          projectDefaultVersion: 1,
          taskOverrideVersion: null,
          taskOverridePolicy: null,
          canManage: false,
          latestRun: null,
        },
      );
      this.activeRead.set(false);
      return;
    }

    const http = this.http;
    if (!http || typeof http.get !== 'function') {
      this.activeRead.set(false);
      this.loadError.set('Source-scope settings are unavailable in this view.');
      return;
    }

    this.activeRead.set(true);
    this.readRequest = forkJoin({
      project: http.get<unknown>(
        `/api/projects/${encodeURIComponent(projectId)}/execution-scope`,
        { withCredentials: true },
      ),
      task: http.get<unknown>(
        `/api/tasks/${encodeURIComponent(taskId)}/execution-scope`,
        { withCredentials: true },
      ),
    }).subscribe({
      next: (response) => {
        try {
          const project = mapProjectExecutionScope(response.project);
          const task = mapTaskExecutionScope(response.task);
          if (!this.isCurrent(generation, projectId, taskId)) {
            return;
          }

          this.applyScope(project, task);
          this.activeRead.set(false);
          this.readRequest = null;
        } catch (error: unknown) {
          this.completeLoadFailure(error, generation, projectId, taskId);
        }
      },
      error: (error: unknown) => this.completeLoadFailure(error, generation, projectId, taskId),
    });
  }

  private applyScope(project: ProjectExecutionScope, task: TaskExecutionScope): void {
    this.state.set({
      projectId: this.normalizedProjectId(),
      taskId: this.normalizedTaskId(),
      project,
      task,
    });
    this.projectWebEnabled.set(project.policy.webEnabled);
    this.projectFilesEnabled.set(project.policy.projectFilesEnabled);
    this.taskEditorMode.set(task.origin === 'TaskOverride' ? 'override' : 'inherit');
    const taskEditorPolicy = task.taskOverridePolicy ?? task.effectivePolicy;
    this.overrideWebEnabled.set(taskEditorPolicy.webEnabled);
    this.overrideProjectFilesEnabled.set(taskEditorPolicy.projectFilesEnabled);
  }

  private completeLoadFailure(error: unknown, generation: number, projectId: string, taskId: string): void {
    if (!this.isCurrent(generation, projectId, taskId)) {
      return;
    }

    this.readRequest = null;
    this.activeRead.set(false);
    const normalized = normalizeApiError(error);
    if (normalized.httpStatus === 401 || normalized.httpStatus === 403 || normalized.httpStatus === 404) {
      this.clearProtectedState();
      return;
    }

    this.loadError.set('Source-scope settings could not be loaded. Try again.');
  }

  private completeMutationFailure(error: unknown, generation: number, projectId: string, taskId: string): void {
    if (!this.isCurrent(generation, projectId, taskId)) {
      return;
    }

    this.mutationRequest = null;
    this.saving.set(null);
    const normalized = normalizeApiError(error);
    if (normalized.httpStatus === 401 || normalized.httpStatus === 403 || normalized.httpStatus === 404) {
      this.clearProtectedState();
      return;
    }

    this.mutationError.set(
      normalized.httpStatus === 409
        ? 'The source scope changed before it could be saved. Reload it and try again.'
        : 'The source-scope update could not be completed. Reload it and try again.',
    );
  }

  private clearProtectedState(): void {
    this.scopeGeneration.update((generation) => generation + 1);
    this.readRequest?.unsubscribe();
    this.mutationRequest?.unsubscribe();
    this.readRequest = null;
    this.mutationRequest = null;
    this.state.set(null);
    this.activeRead.set(false);
    this.saving.set(null);
    this.feedback.set(null);
    this.mutationError.set(null);
    this.loadError.set('Source-scope settings are unavailable in the current session.');
  }

  private isCurrent(generation: number, projectId: string, taskId: string): boolean {
    return generation === this.scopeGeneration() &&
      projectId === this.normalizedProjectId() &&
      taskId === this.normalizedTaskId();
  }

  private normalizedProjectId(): string {
    return this.projectId.trim();
  }

  private normalizedTaskId(): string {
    return this.taskId.trim();
  }

  private focusFeedbackSoon(): void {
    setTimeout(() => this.feedbackElement()?.nativeElement.focus());
  }

  /** Realtime is an invalidation hint only; the next HTTP projection remains authoritative. */
  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    if (event.eventType === 'Security.AuthorizationStateChanged.v1') {
      this.clearProtectedState();
      return;
    }

    const projectId = this.normalizedProjectId();
    const taskId = this.normalizedTaskId();
    if (!projectId || !taskId || this.saving()) {
      return;
    }

    if (event.eventType === 'Projects.ProjectChanged.v1' && event.aggregateId === projectId) {
      this.loadScope();
      return;
    }

    if ([
      'Projects.TaskChanged.v1',
      'Projects.TaskAssignmentChanged.v1',
      'Projects.TaskWorkflowChanged.v1',
      'Projects.TaskCommentChanged.v1',
    ].includes(event.eventType) && event.aggregateId === taskId) {
      this.loadScope();
    }
  }
}

function mapProjectExecutionScope(value: unknown): ProjectExecutionScope {
  const record = requiredRecord(value, 'Project execution scope');
  return {
    policy: mapSourcePolicy(record['policy'], 'Project execution scope policy'),
    version: requiredVersion(record['version'], 'Project execution scope version'),
    canManage: requiredBoolean(record['canManage'], 'Project execution scope permission'),
  };
}

function mapTaskExecutionScope(value: unknown): TaskExecutionScope {
  const record = requiredRecord(value, 'Task execution scope');
  const origin = requiredOrigin(record['origin'], 'Task execution scope origin');
  const overridePolicy = nullableSourcePolicy(record['taskOverridePolicy'], 'Task override policy');
  const overrideVersion = nullableVersion(record['taskOverrideVersion'], 'Task override version');
  if ((origin === 'TaskOverride') !== (overridePolicy !== null) ||
      (origin === 'TaskOverride') !== (overrideVersion !== null)) {
    throw new Error('Task execution scope response has an inconsistent override state.');
  }

  return {
    effectivePolicy: mapSourcePolicy(record['effectivePolicy'], 'Task effective source policy'),
    origin,
    projectDefaultVersion: requiredVersion(record['projectDefaultVersion'], 'Project default version'),
    taskOverrideVersion: overrideVersion,
    taskOverridePolicy: overridePolicy,
    canManage: requiredBoolean(record['canManage'], 'Task execution scope permission'),
    latestRun: nullableLatestRun(record['latestRun']),
  };
}

function nullableLatestRun(value: unknown): LatestExecutionRun | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requiredRecord(value, 'Latest execution run');
  const status = requiredRunStatus(record['status']);
  const majorState = record['majorState'] === null || record['majorState'] === undefined
    ? majorStateFromRunStatus(status)
    : requiredMajorState(record['majorState']);
  return {
    status,
    majorState,
    snapshotScopeOrigin: requiredOrigin(record['snapshotScopeOrigin'], 'Latest execution run source origin'),
    snapshotWebEnabled: requiredBoolean(record['snapshotWebEnabled'], 'Latest execution run Web policy'),
    snapshotProjectFilesEnabled: requiredBoolean(record['snapshotProjectFilesEnabled'], 'Latest execution run file policy'),
  };
}

function mapSourcePolicy(value: unknown, label: string): SourcePolicy {
  const record = requiredRecord(value, label);
  return {
    webEnabled: requiredBoolean(record['webEnabled'], `${label} Web setting`),
    projectFilesEnabled: requiredBoolean(record['projectFilesEnabled'], `${label} Project-files setting`),
  };
}

function nullableSourcePolicy(value: unknown, label: string): SourcePolicy | null {
  return value === null || value === undefined ? null : mapSourcePolicy(value, label);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} response is invalid.`);
  }

  return value as Record<string, unknown>;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} response is invalid.`);
  }

  return value;
}

function requiredVersion(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} response is invalid.`);
  }

  return value;
}

function nullableVersion(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : requiredVersion(value, label);
}

function requiredOrigin(value: unknown, label: string): ScopeOrigin {
  if (value === 'ProjectDefault' || value === 'TaskOverride') {
    return value;
  }

  throw new Error(`${label} response is invalid.`);
}

function requiredRunStatus(value: unknown): RunStatus {
  if (value === 'Accepted' || value === 'Queued' || value === 'Running' || value === 'Succeeded' || value === 'Failed') {
    return value;
  }

  throw new Error('Latest execution run status is invalid.');
}

function requiredMajorState(value: unknown): MajorState {
  if (value === 'Accepted' || value === 'Queued' || value === 'Running' || value === 'Succeeded' || value === 'Failed') {
    return value;
  }

  throw new Error('Latest execution run major state is invalid.');
}

function majorStateFromRunStatus(status: RunStatus): MajorState {
  switch (status) {
    case 'Accepted': return 'Accepted';
    case 'Queued': return 'Queued';
    case 'Running': return 'Running';
    case 'Succeeded': return 'Succeeded';
    case 'Failed': return 'Failed';
  }
}

function checkboxValue(event: Event): boolean {
  return (event.target as HTMLInputElement | null)?.checked === true;
}
