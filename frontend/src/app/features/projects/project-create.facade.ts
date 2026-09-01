import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { FrontendApiError } from '../../core/api/api-error.model';
import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { ProtectedStateClearReason, RealtimeFacade } from '../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import {
  canonicalizeProjectCreateInput,
  ProjectCreateApi,
  ProjectCreateInput,
  ProjectCreateOptions,
  ProjectCreateRequestDto,
  ProjectCreateResponseError,
  ProjectCreateSuccess,
} from './project-create.api';
import { ProjectsFacade } from './projects.facade';

export type ProjectCreateField =
  'title' | 'description' | 'groupId' | 'visibility' | 'startDate' | 'endDate' | 'form';

export interface ProjectCreateFieldError {
  readonly field: ProjectCreateField;
  readonly message: string;
}

export type ProjectCreateOptionsStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

export interface ProjectCreateOptionsViewModel {
  readonly status: ProjectCreateOptionsStatus;
  readonly workspaceId?: string;
  readonly data?: ProjectCreateOptions;
  readonly message?: string;
  readonly requestId?: string;
}

export type ProjectCreateStatus =
  'idle' | 'submitting' | 'error' | 'committedPendingNavigation' | 'succeeded';

export interface ProjectCreateViewModel {
  readonly status: ProjectCreateStatus;
  readonly fieldErrors: readonly ProjectCreateFieldError[];
  readonly message?: string;
  readonly requestId?: string;
  readonly createdProjectId?: string;
}

export const EMPTY_PROJECT_CREATE_OPTIONS: ProjectCreateOptionsViewModel = { status: 'idle' };
export const EMPTY_PROJECT_CREATE_STATE: ProjectCreateViewModel = {
  status: 'idle',
  fieldErrors: [],
};

interface ProjectCreateAttempt {
  readonly identityKey: string;
  readonly workspaceId: string;
  readonly payloadKey: string;
  readonly idempotencyKey: string;
  hasDispatched: boolean;
}

interface CommittedProjectCreate {
  readonly identityKey: string;
  readonly workspaceId: string;
  readonly success: ProjectCreateSuccess;
}

@Injectable({ providedIn: 'root' })
export class ProjectCreateFacade {
  private readonly api = inject(ProjectCreateApi);
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectsFacade);
  private readonly authSession = inject(AuthSessionFacade);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly realtime = inject(RealtimeFacade);
  private readonly destroyRef = inject(DestroyRef);

  private readonly optionsState = signal<ProjectCreateOptionsViewModel>(
    EMPTY_PROJECT_CREATE_OPTIONS,
  );
  private readonly mutationState = signal<ProjectCreateViewModel>(EMPTY_PROJECT_CREATE_STATE);
  private scopeIdentityKey: string | null = null;
  private scopeWorkspaceId: string | null = null;
  private observedIdentityKey = this.currentIdentityKey();
  private scopeGeneration = 0;
  private optionsCancellation = new Subject<void>();
  private mutationCancellation = new Subject<void>();
  private createAttempt: ProjectCreateAttempt | null = null;
  private activeCreateAttempt: ProjectCreateAttempt | null = null;
  private activeCreateHasDispatched = false;
  private committedCreate: CommittedProjectCreate | null = null;

  readonly options = this.optionsState.asReadonly();
  readonly createState = this.mutationState.asReadonly();

  constructor() {
    const unregister = this.realtime.registerProtectedStateClearer('project-create', (reason) =>
      this.clearProtectedState(reason),
    );
    this.destroyRef.onDestroy(unregister);

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

  async loadOptions(workspaceId: string): Promise<boolean> {
    const identityKey = this.currentIdentityKey();
    if (!identityKey) {
      this.optionsState.set({
        status: 'denied',
        workspaceId,
        message: 'Project creation is unavailable in the current session.',
      });
      return false;
    }

    this.activateScope(identityKey, workspaceId);
    this.cancelOptionsRequest();
    const cancellation = this.optionsCancellation;
    const generation = this.scopeGeneration;
    this.optionsState.set({ status: 'loading', workspaceId });

    try {
      const options = await firstValueFrom(
        this.api.getOptions(workspaceId).pipe(takeUntil(cancellation)),
        { defaultValue: null },
      );
      if (!options || !this.isScopeCurrent(generation, identityKey, workspaceId)) {
        return false;
      }

      if (!options.canCreateUngrouped && options.groups.length === 0) {
        this.optionsState.set({
          status: 'denied',
          workspaceId,
          message: 'You do not currently have permission to create a Project in this Workspace.',
          requestId: options.requestId,
        });
        return false;
      }

      this.optionsState.set({
        status: 'ready',
        workspaceId,
        data: options,
        requestId: options.requestId,
      });
      return true;
    } catch (error: unknown) {
      if (!this.isScopeCurrent(generation, identityKey, workspaceId)) {
        return false;
      }
      const normalized = normalizeProjectCreateError(error);
      this.optionsState.set({
        status: normalized.httpStatus === 401 || normalized.httpStatus === 403 ? 'denied' : 'error',
        workspaceId,
        message:
          normalized.httpStatus === 401 || normalized.httpStatus === 403
            ? 'You do not currently have permission to create a Project in this Workspace.'
            : 'Project creation options could not be verified. Try again.',
        requestId: normalized.requestId,
      });
      return false;
    }
  }

  async createProject(workspaceId: string, input: ProjectCreateInput): Promise<boolean> {
    if (this.mutationState().status === 'submitting' || this.activeCreateAttempt !== null) {
      return false;
    }

    const identityKey = this.currentIdentityKey();
    const options = this.optionsState();
    if (
      identityKey &&
      this.committedCreate?.identityKey === identityKey &&
      this.committedCreate.workspaceId === workspaceId &&
      this.committedCreate.workspaceId === this.scopeWorkspaceId
    ) {
      this.markCommittedPendingNavigation(this.committedCreate.success);
      return false;
    }

    if (
      !identityKey ||
      this.scopeIdentityKey !== identityKey ||
      this.scopeWorkspaceId !== workspaceId ||
      options.status !== 'ready' ||
      options.workspaceId !== workspaceId ||
      !options.data
    ) {
      this.setCreateError('Project creation options are unavailable. Reload them and try again.');
      return false;
    }

    const request = canonicalizeProjectCreateInput(input);
    const fieldErrors = validateProjectCreateRequest(request, options.data);
    if (fieldErrors.length > 0) {
      this.mutationState.set({
        status: 'error',
        fieldErrors,
        message: 'Review the highlighted Project details and try again.',
      });
      return false;
    }

    const attempt = this.getOrCreateAttempt(identityKey, workspaceId, request);
    this.activeCreateAttempt = attempt;
    this.activeCreateHasDispatched = false;
    this.cancelMutationRequest();
    const cancellation = this.mutationCancellation;
    const generation = this.scopeGeneration;
    this.mutationState.set({ status: 'submitting', fieldErrors: [] });

    let success: ProjectCreateSuccess | null;
    try {
      success = await firstValueFrom(
        this.api
          .createProject(workspaceId, request, attempt.idempotencyKey, () => {
            if (this.activeCreateAttempt === attempt) {
              attempt.hasDispatched = true;
              this.activeCreateHasDispatched = true;
            }
          })
          .pipe(takeUntil(cancellation)),
        { defaultValue: null },
      );
    } catch (error: unknown) {
      if (this.isScopeCurrent(generation, identityKey, workspaceId)) {
        this.applyCreateError(error);
      }
      return false;
    } finally {
      if (this.activeCreateAttempt === attempt) {
        this.activeCreateAttempt = null;
        this.activeCreateHasDispatched = false;
      }
    }

    if (!success || !this.isScopeCurrent(generation, identityKey, workspaceId)) {
      return false;
    }

    // The strict canonical 201 consumes the key. Commit this client state
    // before any refresh or navigation that can trigger authorization clears.
    this.createAttempt = null;
    this.committedCreate = { identityKey, workspaceId, success };
    return this.continueCommittedNavigation(generation, identityKey, workspaceId, success);
  }

  async retryCreatedProjectNavigation(): Promise<boolean> {
    if (this.mutationState().status === 'submitting') {
      return false;
    }

    const identityKey = this.currentIdentityKey();
    const committed = this.committedCreate;
    if (
      !identityKey ||
      !committed ||
      committed.identityKey !== identityKey ||
      committed.workspaceId !== this.scopeWorkspaceId
    ) {
      return false;
    }

    return this.continueCommittedNavigation(
      this.scopeGeneration,
      identityKey,
      committed.workspaceId,
      committed.success,
    );
  }

  resetCreatePresentation(): void {
    const status = this.mutationState().status;
    if (status === 'submitting' || status === 'committedPendingNavigation') {
      return;
    }
    this.mutationState.set(EMPTY_PROJECT_CREATE_STATE);
  }

  clearWorkspaceScope(): void {
    this.clearProtectedState('workspace');
  }

  private async continueCommittedNavigation(
    generation: number,
    identityKey: string,
    workspaceId: string,
    success: ProjectCreateSuccess,
  ): Promise<boolean> {
    if (!this.isScopeCurrent(generation, identityKey, workspaceId)) {
      return false;
    }

    this.mutationState.set({
      status: 'submitting',
      fieldErrors: [],
      requestId: success.requestId,
      createdProjectId: success.data.id,
    });

    // This starts the authoritative list GET. Project Detail performs its own
    // authoritative GET after navigation; neither follow-up may repeat POST.
    try {
      this.projects.retryProjects();
    } catch {
      // The dedicated confirmation GET below still owns reconciliation.
    }

    if (!this.isScopeCurrent(generation, identityKey, workspaceId)) {
      return false;
    }

    try {
      const confirmation = await firstValueFrom(
        this.api
          .confirmCreatedProject(success.data.id, workspaceId)
          .pipe(takeUntil(this.mutationCancellation)),
        { defaultValue: null },
      );
      if (!confirmation || !this.isScopeCurrent(generation, identityKey, workspaceId)) {
        return false;
      }
    } catch {
      if (this.isScopeCurrent(generation, identityKey, workspaceId)) {
        this.markCommittedPendingNavigation(success);
      }
      return false;
    }

    try {
      const navigated = await this.router.navigate(['/projects', success.data.id]);
      if (!this.isScopeCurrent(generation, identityKey, workspaceId)) {
        return false;
      }
      if (!navigated) {
        this.markCommittedPendingNavigation(success);
        return false;
      }
    } catch {
      if (this.isScopeCurrent(generation, identityKey, workspaceId)) {
        this.markCommittedPendingNavigation(success);
      }
      return false;
    }

    this.committedCreate = null;
    this.mutationState.set({
      status: 'succeeded',
      fieldErrors: [],
      requestId: success.requestId,
      createdProjectId: success.data.id,
    });
    return true;
  }

  private activateScope(identityKey: string, workspaceId: string): void {
    if (this.scopeIdentityKey === identityKey && this.scopeWorkspaceId === workspaceId) {
      return;
    }
    this.clearProtectedState('workspace');
    this.scopeIdentityKey = identityKey;
    this.scopeWorkspaceId = workspaceId;
  }

  private clearProtectedState(reason: ProtectedStateClearReason): void {
    const committed = this.committedCreate;
    const attempt = this.createAttempt;
    const preserveCommitted =
      reason === 'authorization' &&
      committed !== null &&
      committed.identityKey === this.currentIdentityKey() &&
      committed.workspaceId === this.scopeWorkspaceId;
    const preserveUncertainAttempt =
      reason === 'authorization' &&
      committed === null &&
      attempt !== null &&
      attempt.identityKey === this.currentIdentityKey() &&
      attempt.workspaceId === this.scopeWorkspaceId;
    const attemptWasDispatched = preserveUncertainAttempt && attempt?.hasDispatched === true;
    const preserveDispatchedMutation =
      attemptWasDispatched &&
      attempt !== null &&
      this.activeCreateAttempt === attempt &&
      this.activeCreateHasDispatched;

    // Once this exact invocation has dispatched its canonical idempotent POST,
    // an authorization invalidation must not abort the response. The server may
    // already have committed, and cancelling the XHR would only discard the
    // strict 201 needed to reconcile that commit. Pre-dispatch requests and all
    // session/Tenant/Workspace boundary changes remain cancellable.
    if (!preserveDispatchedMutation) {
      this.scopeGeneration += 1;
    }
    this.cancelOptionsRequest();
    if (!preserveDispatchedMutation) {
      this.cancelMutationRequest();
    }

    if (preserveCommitted && committed) {
      // An own-command authorization invalidation may arrive between the
      // verified 201 and follow-up GET/navigation. Clear all server-projected
      // options and form state, but retain the committed command internally so
      // recovery can only issue GET/navigation and never a second POST.
      this.scopeIdentityKey = committed.identityKey;
      this.scopeWorkspaceId = committed.workspaceId;
      this.createAttempt = null;
      this.optionsState.set(EMPTY_PROJECT_CREATE_OPTIONS);
      this.mutationState.set({
        status: 'committedPendingNavigation',
        fieldErrors: [],
        message:
          'The Project was created as Draft. Recheck access and open it without creating another Project.',
      });
      return;
    }

    if (preserveUncertainAttempt && attempt) {
      // An authorization invalidation always clears the protected projection.
      // If any request for this key had reached browser dispatch, the server
      // can have committed before its 201 reached this client. If none had
      // started, the cancellation prevented every POST, so an explicit retry
      // after a fresh options read is required without falsely claiming
      // uncertainty. In either case retain only the opaque canonical payload/key tuple. A
      // session, Tenant, or actual Workspace boundary below destroys it.
      this.scopeIdentityKey = attempt.identityKey;
      this.scopeWorkspaceId = attempt.workspaceId;
      this.createAttempt = attempt;
      this.optionsState.set({
        status: 'error',
        workspaceId: attempt.workspaceId,
        message: 'Project creation options changed and must be checked again.',
      });
      if (preserveDispatchedMutation) {
        this.mutationState.set({ status: 'submitting', fieldErrors: [] });
        return;
      }
      this.mutationState.set({
        status: 'error',
        fieldErrors: [],
        message: attemptWasDispatched
          ? 'The Project may have been created. Recheck access and retry the same details so the server can safely reconcile the request.'
          : 'Project creation was stopped before it was sent. Recheck access and submit the same details after the options reload.',
      });
      return;
    }

    this.scopeIdentityKey = null;
    this.scopeWorkspaceId = null;
    this.createAttempt = null;
    this.committedCreate = null;
    this.optionsState.set(EMPTY_PROJECT_CREATE_OPTIONS);
    this.mutationState.set(EMPTY_PROJECT_CREATE_STATE);
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

  private isScopeCurrent(generation: number, identityKey: string, workspaceId: string): boolean {
    return (
      generation === this.scopeGeneration &&
      identityKey === this.currentIdentityKey() &&
      identityKey === this.scopeIdentityKey &&
      workspaceId === this.scopeWorkspaceId
    );
  }

  private getOrCreateAttempt(
    identityKey: string,
    workspaceId: string,
    request: ProjectCreateRequestDto,
  ): ProjectCreateAttempt {
    const payloadKey = JSON.stringify(request);
    if (
      this.createAttempt?.identityKey === identityKey &&
      this.createAttempt.workspaceId === workspaceId &&
      this.createAttempt.payloadKey === payloadKey
    ) {
      return this.createAttempt;
    }

    this.createAttempt = {
      identityKey,
      workspaceId,
      payloadKey,
      idempotencyKey: createProjectIdempotencyKey(),
      hasDispatched: false,
    };
    return this.createAttempt;
  }

  private applyCreateError(error: unknown): void {
    const normalized = normalizeProjectCreateError(error);
    if (normalized.httpStatus === 401 || normalized.httpStatus === 403) {
      this.optionsState.set({
        status: 'denied',
        workspaceId: this.scopeWorkspaceId ?? undefined,
        message: 'You do not currently have permission to create a Project in this Workspace.',
        requestId: normalized.requestId,
      });
    }

    const uncertain =
      error instanceof ProjectCreateResponseError ||
      normalized.httpStatus === 0 ||
      (normalized.httpStatus >= 200 && normalized.httpStatus < 300) ||
      normalized.httpStatus >= 500;
    this.mutationState.set({
      status: 'error',
      fieldErrors: createFieldErrors(normalized),
      message: uncertain
        ? 'The Project may have been created. Retry with the same details so the server can safely reconcile the request.'
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

  private markCommittedPendingNavigation(success: ProjectCreateSuccess): void {
    this.mutationState.set({
      status: 'committedPendingNavigation',
      fieldErrors: [],
      message:
        'The Project was created as Draft, but it could not be opened yet. Retry opening it without creating another Project.',
      requestId: success.requestId,
      createdProjectId: success.data.id,
    });
  }

  private currentIdentityKey(): string | null {
    const session = this.authSession.session();
    const tenantId = session.currentTenant?.tenantId ?? session.currentTenant?.tenantSlug;
    const userId = session.currentUser?.userId;
    return session.isAuthenticated && tenantId && userId ? `${tenantId}:${userId}` : null;
  }
}

function validateProjectCreateRequest(
  request: ProjectCreateRequestDto,
  options: ProjectCreateOptions,
): readonly ProjectCreateFieldError[] {
  const errors: ProjectCreateFieldError[] = [];
  if (!request.title) {
    errors.push({ field: 'title', message: 'Enter a Project name.' });
  } else if (request.title.length > 200) {
    errors.push({ field: 'title', message: 'Project name must be 200 characters or fewer.' });
  }
  if (request.description !== null && request.description.length > 4000) {
    errors.push({
      field: 'description',
      message: 'Description must be 4,000 characters or fewer.',
    });
  }

  if (request.groupId === null) {
    if (!options.canCreateUngrouped) {
      errors.push({ field: 'groupId', message: 'Choose a Group available to you.' });
    }
  } else if (!options.groups.some((group) => sameId(group.id, request.groupId!))) {
    errors.push({ field: 'groupId', message: 'Choose a Group available to you.' });
  }
  if (!options.allowedVisibilities.includes(request.visibility)) {
    errors.push({
      field: 'visibility',
      message: 'Choose a visibility available to you.',
    });
  }

  if (request.startDate !== null && !isIsoDate(request.startDate)) {
    errors.push({ field: 'startDate', message: 'Enter a valid start date.' });
  }
  if (request.endDate !== null && !isIsoDate(request.endDate)) {
    errors.push({ field: 'endDate', message: 'Enter a valid target end date.' });
  }
  if (
    request.startDate !== null &&
    request.endDate !== null &&
    isIsoDate(request.startDate) &&
    isIsoDate(request.endDate) &&
    request.endDate < request.startDate
  ) {
    errors.push({
      field: 'endDate',
      message: 'Target end date cannot be before the start date.',
    });
  }
  return errors;
}

function createFieldErrors(error: FrontendApiError): readonly ProjectCreateFieldError[] {
  const targets = [
    ...(error.target ? [{ target: error.target, message: error.message }] : []),
    ...error.details,
  ];
  const mapped = targets.map((detail) => ({
    field: projectCreateField(detail.target),
    message: detail.message,
  }));
  return mapped.filter(
    (candidate, index) =>
      mapped.findIndex(
        (item) => item.field === candidate.field && item.message === candidate.message,
      ) === index,
  );
}

function projectCreateField(target: string | undefined): ProjectCreateField {
  const normalized = target?.split('.').at(-1)?.toLowerCase();
  switch (normalized) {
    case 'title':
      return 'title';
    case 'description':
      return 'description';
    case 'groupid':
      return 'groupId';
    case 'visibility':
      return 'visibility';
    case 'startdate':
      return 'startDate';
    case 'enddate':
      return 'endDate';
    default:
      return 'form';
  }
}

function normalizeProjectCreateError(error: unknown): FrontendApiError {
  return normalizeApiError(
    error,
    error instanceof ProjectCreateResponseError ? error.httpStatus : undefined,
  );
}

function createProjectIdempotencyKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `project-create-${randomUuid}`;
  }
  return `project-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
