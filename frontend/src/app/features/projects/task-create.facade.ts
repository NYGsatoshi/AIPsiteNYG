import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { FrontendApiError } from '../../core/api/api-error.model';
import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { ProtectedStateClearReason, RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { TASK_BRIEF_FIELD_MAX_LENGTH } from './projects.types';
import {
  canonicalizeTaskCreateInput,
  TaskCreateApi,
  TaskCreateInput,
  TaskCreateOptions,
  TaskCreateRequestDto,
  TaskCreateResponseError,
  TaskCreateSuccess,
} from './task-create.api';

export type TaskCreateField =
  | 'title'
  | 'description'
  | 'priority'
  | 'milestoneId'
  | 'startDate'
  | 'dueDate'
  | 'goal'
  | 'deliverable'
  | 'constraints'
  | 'primaryAssigneeUserId'
  | 'sourceScopeMode'
  | 'form';

export interface TaskCreateFieldError {
  readonly field: TaskCreateField;
  readonly message: string;
}

export type TaskCreateOptionsStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

export interface TaskCreateOptionsViewModel {
  readonly status: TaskCreateOptionsStatus;
  readonly projectId?: string;
  readonly data?: TaskCreateOptions;
  readonly message?: string;
  readonly requestId?: string;
}

export type TaskCreateStatus =
  | 'idle'
  | 'submitting'
  | 'error'
  | 'committedPendingNavigation'
  | 'succeeded';

export interface TaskCreateViewModel {
  readonly status: TaskCreateStatus;
  readonly fieldErrors: readonly TaskCreateFieldError[];
  readonly message?: string;
  readonly requestId?: string;
  readonly createdTaskId?: string;
}

export const EMPTY_TASK_CREATE_OPTIONS: TaskCreateOptionsViewModel = { status: 'idle' };
export const EMPTY_TASK_CREATE_STATE: TaskCreateViewModel = { status: 'idle', fieldErrors: [] };

interface TaskCreateAttempt {
  readonly identityKey: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly payloadKey: string;
  readonly idempotencyKey: string;
  hasDispatched: boolean;
}

interface CommittedTaskCreate {
  readonly identityKey: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly success: TaskCreateSuccess;
}

const TASK_CREATE_REALTIME_OWNER = 'task-create';

@Injectable({ providedIn: 'root' })
export class TaskCreateFacade {
  private readonly api = inject(TaskCreateApi);
  private readonly router = inject(Router);
  private readonly authSession = inject(AuthSessionFacade);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly realtime = inject(RealtimeFacade);
  private readonly destroyRef = inject(DestroyRef);

  private readonly optionsState = signal<TaskCreateOptionsViewModel>(EMPTY_TASK_CREATE_OPTIONS);
  private readonly mutationState = signal<TaskCreateViewModel>(EMPTY_TASK_CREATE_STATE);
  private scopeIdentityKey: string | null = null;
  private scopeProjectId: string | null = null;
  private scopeWorkspaceId: string | null = null;
  private observedIdentityKey = this.currentIdentityKey();
  private scopeGeneration = 0;
  private optionsCancellation = new Subject<void>();
  private mutationCancellation = new Subject<void>();
  private createAttempt: TaskCreateAttempt | null = null;
  private activeCreateAttempt: TaskCreateAttempt | null = null;
  private committedCreate: CommittedTaskCreate | null = null;
  private realtimeCleanups: (() => void)[] = [];
  private refreshInFlight = false;
  private refreshQueued = false;

  readonly options = this.optionsState.asReadonly();
  readonly createState = this.mutationState.asReadonly();

  constructor() {
    const unregister = this.realtime.registerProtectedStateClearer(
      TASK_CREATE_REALTIME_OWNER,
      (reason) => this.clearProtectedState(reason),
    );
    this.destroyRef.onDestroy(unregister);
    this.destroyRef.onDestroy(() => this.release());
    this.realtime.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event));

    effect(() => {
      const nextIdentityKey = this.currentIdentityKey();
      const nextWorkspaceId = this.activeWorkspace.activeWorkspace()?.id ?? null;
      const identityChanged = nextIdentityKey !== this.observedIdentityKey;
      const activeWorkspaceLeftScope =
        this.scopeWorkspaceId !== null &&
        nextWorkspaceId !== null &&
        nextWorkspaceId !== this.scopeWorkspaceId;

      this.observedIdentityKey = nextIdentityKey;
      if (identityChanged) {
        this.clearProtectedState('session');
      } else if (activeWorkspaceLeftScope) {
        this.clearProtectedState('workspace');
      }
    });
  }

  async load(projectId: string): Promise<boolean> {
    const identityKey = this.currentIdentityKey();
    if (!identityKey) {
      this.optionsState.set({
        status: 'denied',
        projectId,
        message: 'Task creation is unavailable in the current session.',
      });
      return false;
    }

    if (this.scopeProjectId !== projectId || this.scopeIdentityKey !== identityKey) {
      this.clearProtectedState('workspace');
      this.scopeIdentityKey = identityKey;
      this.scopeProjectId = projectId;
      this.registerRealtime(projectId);
    }

    return this.loadOptions(projectId, identityKey);
  }

  async retryOptions(): Promise<boolean> {
    const projectId = this.scopeProjectId;
    const identityKey = this.currentIdentityKey();
    if (!projectId || !identityKey || identityKey !== this.scopeIdentityKey) {
      return false;
    }
    return this.loadOptions(projectId, identityKey);
  }

  async createTask(input: TaskCreateInput): Promise<boolean> {
    if (this.mutationState().status === 'submitting' || this.activeCreateAttempt !== null) {
      return false;
    }

    const identityKey = this.currentIdentityKey();
    const options = this.optionsState();
    if (
      identityKey &&
      this.committedCreate?.identityKey === identityKey &&
      this.committedCreate.projectId === this.scopeProjectId
    ) {
      this.markCommittedPendingNavigation(this.committedCreate.success);
      return false;
    }

    if (
      !identityKey ||
      !this.scopeProjectId ||
      !this.scopeWorkspaceId ||
      this.scopeIdentityKey !== identityKey ||
      options.status !== 'ready' ||
      options.projectId !== this.scopeProjectId ||
      !options.data ||
      !options.data.canCreateTask
    ) {
      this.setCreateError('Task creation options are unavailable. Reload them and try again.');
      return false;
    }

    const request = canonicalizeTaskCreateInput(input);
    const fieldErrors = validateTaskCreateRequest(request, options.data);
    if (fieldErrors.length > 0) {
      this.mutationState.set({
        status: 'error',
        fieldErrors,
        message: 'Review the highlighted Task details and try again.',
      });
      return false;
    }

    const projectId = this.scopeProjectId;
    const workspaceId = this.scopeWorkspaceId;
    const attempt = this.getOrCreateAttempt(identityKey, projectId, workspaceId, request);
    this.activeCreateAttempt = attempt;
    this.cancelMutationRequest();
    const cancellation = this.mutationCancellation;
    const generation = this.scopeGeneration;
    this.mutationState.set({ status: 'submitting', fieldErrors: [] });

    let success: TaskCreateSuccess | null;
    try {
      success = await firstValueFrom(
        this.api
          .createTask(projectId, workspaceId, request, attempt.idempotencyKey, () => {
            if (this.activeCreateAttempt === attempt) {
              attempt.hasDispatched = true;
            }
          })
          .pipe(takeUntil(cancellation)),
        { defaultValue: null },
      );
    } catch (error: unknown) {
      if (this.isScopeCurrent(generation, identityKey, projectId, workspaceId)) {
        this.applyCreateError(error);
      }
      return false;
    } finally {
      if (this.activeCreateAttempt === attempt) {
        this.activeCreateAttempt = null;
      }
    }

    if (!success || !this.isScopeCurrent(generation, identityKey, projectId, workspaceId)) {
      return false;
    }

    // A strict 201 is recorded before any router/realtime work. A later
    // navigation failure can only offer navigation recovery, never a second POST.
    this.createAttempt = null;
    this.committedCreate = { identityKey, projectId, workspaceId, success };
    return this.continueCommittedNavigation(generation, identityKey, success);
  }

  async retryCreatedTaskNavigation(): Promise<boolean> {
    if (this.mutationState().status === 'submitting') {
      return false;
    }

    const identityKey = this.currentIdentityKey();
    const committed = this.committedCreate;
    if (
      !identityKey ||
      !committed ||
      committed.identityKey !== identityKey ||
      committed.projectId !== this.scopeProjectId ||
      committed.workspaceId !== this.scopeWorkspaceId
    ) {
      return false;
    }

    return this.continueCommittedNavigation(this.scopeGeneration, identityKey, committed.success);
  }

  resetCreatePresentation(): void {
    const status = this.mutationState().status;
    if (status === 'submitting' || status === 'committedPendingNavigation') {
      return;
    }
    this.mutationState.set(EMPTY_TASK_CREATE_STATE);
  }

  release(): void {
    this.releaseRealtime();
    this.clearProtectedState('workspace');
  }

  private async continueCommittedNavigation(
    generation: number,
    identityKey: string,
    success: TaskCreateSuccess,
  ): Promise<boolean> {
    const committed = this.committedCreate;
    if (
      !committed ||
      committed.success !== success ||
      !this.isScopeCurrent(generation, identityKey, committed.projectId, committed.workspaceId)
    ) {
      return false;
    }

    this.mutationState.set({
      status: 'submitting',
      fieldErrors: [],
      requestId: success.requestId,
      createdTaskId: success.data.taskId,
    });

    try {
      const navigated = await this.router.navigate([
        '/projects',
        success.data.projectId,
        'tasks',
        success.data.taskId,
      ]);
      if (!this.isScopeCurrent(generation, identityKey, committed.projectId, committed.workspaceId)) {
        return false;
      }
      if (!navigated) {
        this.markCommittedPendingNavigation(success);
        return false;
      }
    } catch {
      if (this.isScopeCurrent(generation, identityKey, committed.projectId, committed.workspaceId)) {
        this.markCommittedPendingNavigation(success);
      }
      return false;
    }

    this.committedCreate = null;
    this.mutationState.set({
      status: 'succeeded',
      fieldErrors: [],
      requestId: success.requestId,
      createdTaskId: success.data.taskId,
    });
    return true;
  }

  private async loadOptions(projectId: string, identityKey: string): Promise<boolean> {
    this.cancelOptionsRequest();
    const cancellation = this.optionsCancellation;
    const generation = this.scopeGeneration;
    this.optionsState.set({ status: 'loading', projectId });

    try {
      const options = await firstValueFrom(
        this.api.getOptions(projectId).pipe(takeUntil(cancellation)),
        { defaultValue: null },
      );
      if (!options || !this.isProjectScopeCurrent(generation, identityKey, projectId)) {
        return false;
      }
      if (this.scopeWorkspaceId !== null && this.scopeWorkspaceId !== options.workspaceId) {
        this.optionsState.set({
          status: 'denied',
          projectId,
          message: 'Task creation is not available for the current Workspace context.',
          requestId: options.requestId,
        });
        return false;
      }
      this.scopeWorkspaceId = options.workspaceId;
      if (!options.canCreateTask) {
        this.optionsState.set({
          status: 'denied',
          projectId,
          message: 'You do not currently have permission to create a Task in this Project.',
          requestId: options.requestId,
        });
        return false;
      }

      this.optionsState.set({
        status: 'ready',
        projectId,
        data: options,
        requestId: options.requestId,
      });
      return true;
    } catch (error: unknown) {
      if (!this.isProjectScopeCurrent(generation, identityKey, projectId)) {
        return false;
      }
      const normalized = normalizeTaskCreateError(error);
      this.optionsState.set({
        status:
          normalized.httpStatus === 401 ||
          normalized.httpStatus === 403 ||
          normalized.httpStatus === 404
            ? 'denied'
            : 'error',
        projectId,
        message:
          normalized.httpStatus === 401 ||
          normalized.httpStatus === 403 ||
          normalized.httpStatus === 404
            ? 'Task creation is not available for this Project.'
            : 'Task creation options could not be verified. Try again.',
        requestId: normalized.requestId,
      });
      return false;
    } finally {
      if (
        this.optionsCancellation === cancellation &&
        generation === this.scopeGeneration &&
        this.scopeProjectId === projectId
      ) {
        this.refreshInFlight = false;
        if (this.refreshQueued) {
          this.refreshQueued = false;
          void this.refreshFromRealtime();
        }
      }
    }
  }

  private registerRealtime(projectId: string): void {
    this.releaseRealtime();
    this.realtimeCleanups.push(
      this.realtime.registerSubscription(TASK_CREATE_REALTIME_OWNER, {
        subscriptionType: 'project',
        resourceId: projectId,
      }),
      this.realtime.registerCatchUp(TASK_CREATE_REALTIME_OWNER, async (context) => {
        if (this.scopeProjectId !== projectId) {
          return;
        }
        if (context.deniedOwners.has(TASK_CREATE_REALTIME_OWNER)) {
          this.clearProtectedState('authorization');
          this.optionsState.set({
            status: 'denied',
            projectId,
            message: 'Task creation is not available for this Project.',
          });
          return;
        }
        await this.refreshFromRealtime();
      }),
    );
  }

  private releaseRealtime(): void {
    for (const cleanup of this.realtimeCleanups.splice(0)) {
      cleanup();
    }
  }

  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    const projectId = this.scopeProjectId;
    if (!projectId || !eventTargetsProject(event, projectId)) {
      return;
    }
    if (
      event.eventType === 'Projects.ProjectChanged.v1' ||
      event.eventType === 'Projects.TaskChanged.v1' ||
      event.eventType === 'Projects.TaskAssignmentChanged.v1' ||
      event.eventType === 'Projects.TaskWorkflowChanged.v1'
    ) {
      void this.refreshFromRealtime();
    }
  }

  private async refreshFromRealtime(): Promise<void> {
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return;
    }
    const projectId = this.scopeProjectId;
    const identityKey = this.currentIdentityKey();
    if (!projectId || !identityKey || identityKey !== this.scopeIdentityKey) {
      return;
    }
    this.refreshInFlight = true;
    await this.loadOptions(projectId, identityKey);
  }

  private clearProtectedState(reason: ProtectedStateClearReason): void {
    const committed = this.committedCreate;
    const attempt = this.createAttempt;
    const preserveCommitted =
      reason === 'authorization' &&
      committed !== null &&
      committed.identityKey === this.currentIdentityKey() &&
      committed.projectId === this.scopeProjectId &&
      committed.workspaceId === this.scopeWorkspaceId;
    const preserveUncertainAttempt =
      reason === 'authorization' &&
      committed === null &&
      attempt !== null &&
      attempt.identityKey === this.currentIdentityKey() &&
      attempt.projectId === this.scopeProjectId &&
      attempt.workspaceId === this.scopeWorkspaceId;
    const routeIntent =
      reason === 'authorization' &&
      committed === null &&
      attempt === null &&
      this.scopeIdentityKey === this.currentIdentityKey() &&
      this.scopeProjectId !== null
        ? {
            identityKey: this.scopeIdentityKey,
            projectId: this.scopeProjectId,
          }
        : null;
    const attemptWasDispatched = preserveUncertainAttempt && attempt?.hasDispatched === true;
    const preserveDispatchedMutation =
      attemptWasDispatched &&
      attempt !== null &&
      this.activeCreateAttempt === attempt;

    // An authorization invalidation can race a canonical idempotent create after
    // the browser has dispatched the POST but before its strict 201 arrives. At
    // that point aborting the XHR cannot undo a server commit; it only destroys
    // the result and leaves the client in an unnecessarily uncertain state.
    // Keep the create request/generation alive only for that same authenticated
    // Project/Workspace scope. Session, Tenant, and Workspace boundaries still
    // cancel it below, and every follow-up Task route reauthorizes over HTTP.
    if (!preserveDispatchedMutation) {
      this.scopeGeneration += 1;
    }
    this.cancelOptionsRequest();
    if (!preserveDispatchedMutation) {
      this.cancelMutationRequest();
    }
    this.refreshInFlight = false;
    this.refreshQueued = false;

    if (preserveCommitted && committed) {
      this.scopeIdentityKey = committed.identityKey;
      this.scopeProjectId = committed.projectId;
      this.scopeWorkspaceId = committed.workspaceId;
      this.createAttempt = null;
      this.optionsState.set(EMPTY_TASK_CREATE_OPTIONS);
      this.mutationState.set({
        status: 'committedPendingNavigation',
        fieldErrors: [],
        message:
          'The Task was created, but access changed before it could be opened. Recheck access and open it without creating another Task.',
        requestId: committed.success.requestId,
        createdTaskId: committed.success.data.taskId,
      });
      return;
    }

    if (preserveUncertainAttempt && attempt) {
      this.scopeIdentityKey = attempt.identityKey;
      this.scopeProjectId = attempt.projectId;
      this.scopeWorkspaceId = attempt.workspaceId;
      this.createAttempt = attempt;
      this.optionsState.set({
        status: 'error',
        projectId: attempt.projectId,
        message: 'Task creation options changed and must be checked again.',
      });
      if (preserveDispatchedMutation) {
        // Keep the mutation presentation pending until this exact dispatched
        // request returns. The response is still accepted only if its strict
        // canonical 201 maps back to the same Project/Workspace identifiers.
        this.mutationState.set({ status: 'submitting', fieldErrors: [] });
        return;
      }
      this.mutationState.set({
        status: 'error',
        fieldErrors: [],
        message: attemptWasDispatched
          ? 'The Task may have been created. Recheck access and retry the same details so the server can safely reconcile the request.'
          : 'Task creation was stopped before it was sent. Recheck access and submit the same details after the options reload.',
      });
      return;
    }

    if (routeIntent) {
      // A route identifier is not a protected projection. Keep only that
      // opaque intent so the existing realtime subscription can perform a
      // fresh, server-authorized catch-up after a global authorization reset.
      // No prior options, named choices, policy, permission, request id, or
      // create attempt survives this boundary.
      this.scopeIdentityKey = routeIntent.identityKey;
      this.scopeProjectId = routeIntent.projectId;
      this.scopeWorkspaceId = null;
      this.createAttempt = null;
      this.activeCreateAttempt = null;
      this.committedCreate = null;
      this.optionsState.set(EMPTY_TASK_CREATE_OPTIONS);
      this.mutationState.set(EMPTY_TASK_CREATE_STATE);
      return;
    }

    this.scopeIdentityKey = null;
    this.scopeProjectId = null;
    this.scopeWorkspaceId = null;
    this.createAttempt = null;
    this.activeCreateAttempt = null;
    this.committedCreate = null;
    this.optionsState.set(EMPTY_TASK_CREATE_OPTIONS);
    this.mutationState.set(EMPTY_TASK_CREATE_STATE);
  }

  private isProjectScopeCurrent(
    generation: number,
    identityKey: string,
    projectId: string,
  ): boolean {
    return (
      generation === this.scopeGeneration &&
      identityKey === this.currentIdentityKey() &&
      identityKey === this.scopeIdentityKey &&
      projectId === this.scopeProjectId
    );
  }

  private isScopeCurrent(
    generation: number,
    identityKey: string,
    projectId: string,
    workspaceId: string,
  ): boolean {
    return (
      this.isProjectScopeCurrent(generation, identityKey, projectId) &&
      workspaceId === this.scopeWorkspaceId
    );
  }

  private cancelOptionsRequest(): void {
    this.optionsCancellation.next();
    this.optionsCancellation.complete();
    this.optionsCancellation = new Subject<void>();
  }

  private cancelMutationRequest(): void {
    this.mutationCancellation.next();
    this.mutationCancellation.complete();
    this.mutationCancellation = new Subject<void>();
  }

  private getOrCreateAttempt(
    identityKey: string,
    projectId: string,
    workspaceId: string,
    request: TaskCreateRequestDto,
  ): TaskCreateAttempt {
    const payloadKey = JSON.stringify(request);
    if (
      this.createAttempt?.identityKey === identityKey &&
      this.createAttempt.projectId === projectId &&
      this.createAttempt.workspaceId === workspaceId &&
      this.createAttempt.payloadKey === payloadKey
    ) {
      return this.createAttempt;
    }

    this.createAttempt = {
      identityKey,
      projectId,
      workspaceId,
      payloadKey,
      idempotencyKey: createTaskIdempotencyKey(),
      hasDispatched: false,
    };
    return this.createAttempt;
  }

  private applyCreateError(error: unknown): void {
    const normalized = normalizeTaskCreateError(error);
    if (
      normalized.httpStatus === 401 ||
      normalized.httpStatus === 403 ||
      normalized.httpStatus === 404
    ) {
      this.optionsState.set({
        status: 'denied',
        projectId: this.scopeProjectId ?? undefined,
        message: 'Task creation is not available for this Project.',
        requestId: normalized.requestId,
      });
    }

    const uncertain =
      error instanceof TaskCreateResponseError ||
      normalized.httpStatus === 0 ||
      (normalized.httpStatus >= 200 && normalized.httpStatus < 300) ||
      normalized.httpStatus >= 500;
    this.mutationState.set({
      status: 'error',
      fieldErrors: createFieldErrors(normalized),
      message: uncertain
        ? 'The Task may have been created. Retry with the same details so the server can safely reconcile the request.'
        : normalized.message,
      requestId: normalized.requestId,
    });
  }

  private setCreateError(message: string): void {
    this.mutationState.set({
      status: 'error',
      fieldErrors: [{ field: 'form', message }],
      message,
    });
  }

  private markCommittedPendingNavigation(success: TaskCreateSuccess): void {
    this.mutationState.set({
      status: 'committedPendingNavigation',
      fieldErrors: [],
      message:
        'The Task was created, but it could not be opened yet. Open it again without submitting another create request.',
      requestId: success.requestId,
      createdTaskId: success.data.taskId,
    });
  }

  private currentIdentityKey(): string | null {
    const session = this.authSession.session();
    const tenantId = session.currentTenant?.tenantId ?? session.currentTenant?.tenantSlug;
    const userId = session.currentUser?.userId;
    return session.isAuthenticated && tenantId && userId ? `${tenantId}:${userId}` : null;
  }
}

function validateTaskCreateRequest(
  request: TaskCreateRequestDto,
  options: TaskCreateOptions,
): readonly TaskCreateFieldError[] {
  const errors: TaskCreateFieldError[] = [];
  if (!request.title) {
    errors.push({ field: 'title', message: 'Enter a Task title.' });
  } else if (request.title.length > 240) {
    errors.push({ field: 'title', message: 'Task title must be 240 characters or fewer.' });
  }
  if (request.description && request.description.length > 8000) {
    errors.push({ field: 'description', message: 'Description must be 8,000 characters or fewer.' });
  }
  for (const [field, value, label] of [
    ['goal', request.goal, 'Goal'],
    ['deliverable', request.deliverable, 'Deliverable'],
    ['constraints', request.constraints, 'Constraints'],
  ] as const) {
    if (value && value.length > TASK_BRIEF_FIELD_MAX_LENGTH) {
      errors.push({
        field,
        message: `${label} must be ${TASK_BRIEF_FIELD_MAX_LENGTH.toLocaleString()} characters or fewer.`,
      });
    }
  }
  if (!Number.isSafeInteger(request.priority) || request.priority < 0 || request.priority > 3) {
    errors.push({ field: 'priority', message: 'Choose a supported priority.' });
  }
  if (
    request.milestoneId &&
    !options.milestones.some((milestone) => sameId(milestone.id, request.milestoneId!))
  ) {
    errors.push({ field: 'milestoneId', message: 'Choose a Milestone available to this Task.' });
  }
  if (
    request.primaryAssigneeUserId &&
    !options.assignees.some((assignee) => sameId(assignee.userId, request.primaryAssigneeUserId!))
  ) {
    errors.push({ field: 'primaryAssigneeUserId', message: 'Choose an assignee available to this Project.' });
  }
  if (request.startDate && !isIsoDate(request.startDate)) {
    errors.push({ field: 'startDate', message: 'Enter a valid start date.' });
  }
  if (request.dueDate && !isIsoDate(request.dueDate)) {
    errors.push({ field: 'dueDate', message: 'Enter a valid due date.' });
  }
  if (
    request.startDate &&
    request.dueDate &&
    isIsoDate(request.startDate) &&
    isIsoDate(request.dueDate) &&
    request.dueDate < request.startDate
  ) {
    errors.push({ field: 'dueDate', message: 'Due date cannot be before the start date.' });
  }
  if (request.sourceScopeMode === 'Inherit' && request.taskOverridePolicy) {
    errors.push({ field: 'sourceScopeMode', message: 'Inherited scope cannot include a Task override.' });
  }
  if (
    request.sourceScopeMode === 'TaskOverride' &&
    (!options.canManageProject ||
      !options.projectScope.canSetTaskOverride ||
      !request.taskOverridePolicy)
  ) {
    errors.push({
      field: 'sourceScopeMode',
      message: 'A Task-specific source policy is not available for the current Project authority.',
    });
  }
  return errors;
}

function createFieldErrors(error: FrontendApiError): readonly TaskCreateFieldError[] {
  const targets = [
    ...(error.target ? [{ target: error.target, message: error.message }] : []),
    ...error.details,
  ];
  const mapped = targets.map((detail) => ({
    field: taskCreateField(detail.target),
    message: detail.message,
  }));
  return mapped.filter(
    (candidate, index) =>
      mapped.findIndex(
        (item) => item.field === candidate.field && item.message === candidate.message,
      ) === index,
  );
}

function taskCreateField(target: string | undefined): TaskCreateField {
  const normalized = target?.split('.').at(-1)?.toLowerCase();
  switch (normalized) {
    case 'title':
      return 'title';
    case 'description':
      return 'description';
    case 'priority':
      return 'priority';
    case 'milestoneid':
      return 'milestoneId';
    case 'startdate':
      return 'startDate';
    case 'duedate':
      return 'dueDate';
    case 'goal':
      return 'goal';
    case 'deliverable':
      return 'deliverable';
    case 'constraints':
      return 'constraints';
    case 'primaryassigneeuserid':
      return 'primaryAssigneeUserId';
    case 'sourcescopemode':
    case 'taskoverridepolicy':
    case 'webenabled':
    case 'projectfilesenabled':
      return 'sourceScopeMode';
    default:
      return 'form';
  }
}

function normalizeTaskCreateError(error: unknown): FrontendApiError {
  return normalizeApiError(
    error,
    error instanceof TaskCreateResponseError ? error.httpStatus : undefined,
  );
}

function createTaskIdempotencyKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `task-create-${randomUuid}`;
  }
  return `task-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function eventTargetsProject(event: DurableRealtimeEvent, projectId: string): boolean {
  if (event.aggregateId.toLowerCase() === projectId.toLowerCase()) {
    return true;
  }
  const payloadProjectId = event.payload['projectId'];
  return typeof payloadProjectId === 'string' && payloadProjectId.toLowerCase() === projectId.toLowerCase();
}
