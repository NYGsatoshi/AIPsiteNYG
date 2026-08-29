import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import {
  HttpRequestDispatchSignal,
  HTTP_REQUEST_DISPATCH_SIGNAL,
} from '../../core/api/http-request-dispatch.context';
import { TaskPriority } from './projects.types';

export type TaskCreateSourceScopeMode = 'Inherit' | 'TaskOverride';

export interface TaskCreateSourcePolicy {
  readonly webEnabled: boolean;
  readonly projectFilesEnabled: boolean;
}

export interface TaskCreateMilestoneOption {
  readonly id: string;
  readonly title: string;
}

export interface TaskCreateAssigneeOption {
  readonly userId: string;
  readonly displayName: string;
}

export interface TaskCreateProjectScope {
  readonly policy: TaskCreateSourcePolicy;
  readonly version: number;
  readonly canSetTaskOverride: boolean;
}

/** Server-authorized context only. The browser never synthesizes these choices. */
export interface TaskCreateOptions {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly projectTitle: string;
  readonly canCreateTask: boolean;
  readonly canManageProject: boolean;
  readonly milestones: readonly TaskCreateMilestoneOption[];
  readonly assignees: readonly TaskCreateAssigneeOption[];
  readonly projectScope: TaskCreateProjectScope;
}

export interface TaskCreateInput {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly milestoneId: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly goal: string;
  readonly deliverable: string;
  readonly constraints: string;
  readonly primaryAssigneeUserId: string;
  readonly sourceScopeMode: TaskCreateSourceScopeMode;
  readonly taskOverridePolicy: TaskCreateSourcePolicy | null;
}

/**
 * Keep the browser command deliberately smaller than a general Task DTO. The
 * Project is route/server-owned; all nullable form values are omitted rather
 * than represented as guessed identifiers or empty strings.
 */
export interface TaskCreateRequestDto {
  readonly title: string;
  readonly priority: number;
  readonly description?: string;
  readonly milestoneId?: string;
  readonly startDate?: string;
  readonly dueDate?: string;
  readonly goal?: string;
  readonly deliverable?: string;
  readonly constraints?: string;
  readonly primaryAssigneeUserId?: string;
  readonly sourceScopeMode: TaskCreateSourceScopeMode;
  readonly taskOverridePolicy?: TaskCreateSourcePolicy;
}

export interface CreatedTaskDto {
  readonly taskId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly milestoneId: string | null;
  readonly primaryAssigneeUserId: string | null;
  readonly title: string;
  readonly priority: number;
  readonly status: number;
  readonly workflowStageId: string;
  readonly version: number;
  readonly sourceScopeMode: TaskCreateSourceScopeMode;
  readonly taskOverridePolicy: TaskCreateSourcePolicy | null;
}

export interface TaskCreateSuccess {
  readonly requestId: string;
  readonly data: CreatedTaskDto;
  readonly warnings: readonly unknown[];
}

/** A malformed 2xx must remain retry-safe by retaining the idempotency key. */
export class TaskCreateResponseError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'TaskCreateResponseError';
  }
}

@Injectable({ providedIn: 'root' })
export class TaskCreateApi {
  private readonly http = inject(HttpClient);

  getOptions(projectId: string): Observable<TaskCreateOptions> {
    const expectedProjectId = requiredInputUuid(projectId, 'Project');
    return this.http
      .get<unknown>(
        `/api/projects/${encodeURIComponent(expectedProjectId)}/tasks/create-options`,
        { withCredentials: true },
      )
      .pipe(map((response) => mapTaskCreateOptions(response, expectedProjectId)));
  }

  createTask(
    projectId: string,
    workspaceId: string,
    request: TaskCreateRequestDto,
    idempotencyKey: string,
    onDispatch?: () => void,
  ): Observable<TaskCreateSuccess> {
    const expectedProjectId = requiredInputUuid(projectId, 'Project');
    const expectedWorkspaceId = requiredInputUuid(workspaceId, 'Workspace');
    if (!isValidIdempotencyKey(idempotencyKey)) {
      throw new Error('A valid idempotency key is required.');
    }

    return this.http
      .post<unknown>(
        `/api/projects/${encodeURIComponent(expectedProjectId)}/tasks/create`,
        request,
        {
          headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }),
          context: onDispatch
            ? new HttpContext().set(
                HTTP_REQUEST_DISPATCH_SIGNAL,
                new HttpRequestDispatchSignal(onDispatch),
              )
            : undefined,
          observe: 'response',
          withCredentials: true,
        },
      )
      .pipe(
        map((response) =>
          mapTaskCreateSuccess(
            response.status,
            response.body,
            expectedProjectId,
            expectedWorkspaceId,
          ),
        ),
      );
  }
}

export function canonicalizeTaskCreateInput(input: TaskCreateInput): TaskCreateRequestDto {
  const sourceScopeMode = input.sourceScopeMode;
  const policy = input.taskOverridePolicy;
  return {
    title: input.title.trim(),
    priority: taskPriorityApiValues[input.priority],
    ...optionalProperty('description', input.description),
    ...optionalProperty('milestoneId', input.milestoneId),
    ...optionalProperty('startDate', input.startDate),
    ...optionalProperty('dueDate', input.dueDate),
    ...optionalProperty('goal', input.goal),
    ...optionalProperty('deliverable', input.deliverable),
    ...optionalProperty('constraints', input.constraints),
    ...optionalProperty('primaryAssigneeUserId', input.primaryAssigneeUserId),
    sourceScopeMode,
    ...(sourceScopeMode === 'TaskOverride' && policy ? { taskOverridePolicy: policy } : {}),
  };
}

export function mapTaskCreateOptions(value: unknown, expectedProjectId: string): TaskCreateOptions {
  const envelope = recordValue(value, 'Task create options response');
  const requestId = requiredString(envelope['requestId'], 'requestId', 200);
  if (!Array.isArray(envelope['warnings'])) {
    throw invalidResponse('Task create options response warnings must be an array.', 200);
  }

  const data = recordValue(envelope['data'], 'Task create options response data');
  const projectId = requiredUuid(data['projectId'], 'data.projectId', 200);
  if (!sameUuid(projectId, expectedProjectId)) {
    throw invalidResponse('Task create options belong to a different Project.', 200);
  }
  const workspaceId = requiredUuid(data['workspaceId'], 'data.workspaceId', 200);
  const projectTitle = requiredString(data['projectTitle'], 'data.projectTitle', 200);
  const canCreateTask = requiredBoolean(data['canCreateTask'], 'data.canCreateTask', 200);
  const canManageProject = requiredBoolean(data['canManageProject'], 'data.canManageProject', 200);
  const milestones = mapMilestones(data['milestones']);
  const assignees = mapAssignees(data['assignees']);
  const projectScope = mapProjectScope(data['projectScope']);

  return {
    requestId,
    projectId,
    workspaceId,
    projectTitle,
    canCreateTask,
    canManageProject,
    milestones,
    assignees,
    projectScope,
  };
}

/**
 * A canonical HTTP 201 is the only proof that this browser can move into
 * navigation-only recovery. The route scope and response structure are
 * checked strictly, while mutable Task values are deliberately treated as
 * authoritative: an idempotency replay can return the Task after a later
 * permitted edit.
 */
export function mapTaskCreateSuccess(
  httpStatus: number,
  value: unknown,
  expectedProjectId: string,
  expectedWorkspaceId: string,
): TaskCreateSuccess {
  if (httpStatus !== 201) {
    throw invalidResponse('Task create response must use HTTP 201.', httpStatus);
  }

  const envelope = recordValue(value, 'Task create response', httpStatus);
  const requestId = requiredString(envelope['requestId'], 'requestId', httpStatus);
  if (!Array.isArray(envelope['warnings'])) {
    throw invalidResponse('Task create response warnings must be an array.', httpStatus);
  }

  const data = recordValue(envelope['data'], 'Task create response data', httpStatus);
  const taskId = requiredUuid(data['taskId'], 'data.taskId', httpStatus);
  const projectId = requiredUuid(data['projectId'], 'data.projectId', httpStatus);
  const workspaceId = requiredUuid(data['workspaceId'], 'data.workspaceId', httpStatus);
  if (!sameUuid(projectId, expectedProjectId) || !sameUuid(workspaceId, expectedWorkspaceId)) {
    throw invalidResponse('Task create response belongs to a different scope.', httpStatus);
  }

  const milestoneId = nullableUuid(data['milestoneId'], 'data.milestoneId', httpStatus);
  const primaryAssigneeUserId = nullableUuid(
    data['primaryAssigneeUserId'],
    'data.primaryAssigneeUserId',
    httpStatus,
  );
  const title = requiredString(data['title'], 'data.title', httpStatus);
  const priority = requiredEnumNumber(data['priority'], 'data.priority', httpStatus, 3);
  const status = requiredEnumNumber(data['status'], 'data.status', httpStatus, 5);
  const workflowStageId = requiredUuid(data['workflowStageId'], 'data.workflowStageId', httpStatus);
  const version = positiveSafeInteger(data['version'], 'data.version', httpStatus);
  const sourceScopeMode = requiredSourceScopeMode(
    data['sourceScopeMode'],
    'data.sourceScopeMode',
    httpStatus,
  );

  const taskOverridePolicy = nullablePolicy(
    data['taskOverridePolicy'],
    'data.taskOverridePolicy',
    httpStatus,
  );
  if ((sourceScopeMode === 'Inherit') !== (taskOverridePolicy === null)) {
    throw invalidResponse('Task create response source mode and policy are inconsistent.', httpStatus);
  }

  return {
    requestId,
    data: {
      taskId,
      projectId,
      workspaceId,
      milestoneId,
      primaryAssigneeUserId,
      title,
      priority,
      status,
      workflowStageId,
      version,
      sourceScopeMode,
      taskOverridePolicy,
    },
    warnings: envelope['warnings'],
  };
}

const taskPriorityApiValues: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

function mapMilestones(value: unknown): readonly TaskCreateMilestoneOption[] {
  if (!Array.isArray(value)) {
    throw invalidResponse('Task create options data.milestones must be an array.', 200);
  }
  const milestones = value.map((item, index) => {
    const candidate = recordValue(item, `Task create milestone ${index}`);
    return {
      id: requiredUuid(candidate['id'], `data.milestones[${index}].id`, 200),
      title: requiredString(candidate['title'], `data.milestones[${index}].title`, 200),
    };
  });
  ensureUniqueIds(milestones, 'Task create options contain duplicate Milestones.');
  return milestones;
}

function mapAssignees(value: unknown): readonly TaskCreateAssigneeOption[] {
  if (!Array.isArray(value)) {
    throw invalidResponse('Task create options data.assignees must be an array.', 200);
  }
  const assignees = value.map((item, index) => {
    const candidate = recordValue(item, `Task create assignee ${index}`);
    return {
      userId: requiredUuid(candidate['userId'], `data.assignees[${index}].userId`, 200),
      displayName: requiredString(
        candidate['displayName'],
        `data.assignees[${index}].displayName`,
        200,
      ),
    };
  });
  ensureUniqueIds(
    assignees.map((assignee) => ({ id: assignee.userId })),
    'Task create options contain duplicate assignees.',
  );
  return assignees;
}

function mapProjectScope(value: unknown): TaskCreateProjectScope {
  const scope = recordValue(value, 'Task create options data.projectScope');
  return {
    policy: requiredPolicy(scope['policy'], 'data.projectScope.policy', 200),
    // A Project with no stored default policy is intentionally fail-closed and
    // reports the synthetic default at version 0.
    version: nonNegativeSafeInteger(scope['version'], 'data.projectScope.version', 200),
    canSetTaskOverride: requiredBoolean(
      scope['canSetTaskOverride'],
      'data.projectScope.canSetTaskOverride',
      200,
    ),
  };
}

function optionalProperty<T extends string>(key: T, value: string): Partial<Record<T, string>> {
  const normalized = value.trim();
  return normalized.length > 0 ? { [key]: normalized } as Record<T, string> : {};
}

function recordValue(value: unknown, label: string, httpStatus = 200): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse(`${label} must be an object.`, httpStatus);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string, httpStatus: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidResponse(`Task response ${path} must be a non-empty string.`, httpStatus);
  }
  return value.trim();
}

function requiredUuid(value: unknown, path: string, httpStatus: number): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw invalidResponse(`Task response ${path} must be a UUID.`, httpStatus);
  }
  return value;
}

function nullableUuid(value: unknown, path: string, httpStatus: number): string | null {
  return value === null ? null : requiredUuid(value, path, httpStatus);
}

function requiredBoolean(value: unknown, path: string, httpStatus: number): boolean {
  if (typeof value !== 'boolean') {
    throw invalidResponse(`Task response ${path} must be a boolean.`, httpStatus);
  }
  return value;
}

function requiredEnumNumber(
  value: unknown,
  path: string,
  httpStatus: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw invalidResponse(`Task response ${path} is not a supported enum value.`, httpStatus);
  }
  return value;
}

function requiredSourceScopeMode(
  value: unknown,
  path: string,
  httpStatus: number,
): TaskCreateSourceScopeMode {
  if (value !== 'Inherit' && value !== 'TaskOverride') {
    throw invalidResponse(`Task response ${path} is not a supported source scope mode.`, httpStatus);
  }
  return value;
}

function requiredPolicy(value: unknown, path: string, httpStatus: number): TaskCreateSourcePolicy {
  const policy = recordValue(value, `Task response ${path}`, httpStatus);
  return {
    webEnabled: requiredBoolean(policy['webEnabled'], `${path}.webEnabled`, httpStatus),
    projectFilesEnabled: requiredBoolean(
      policy['projectFilesEnabled'],
      `${path}.projectFilesEnabled`,
      httpStatus,
    ),
  };
}

function nullablePolicy(
  value: unknown,
  path: string,
  httpStatus: number,
): TaskCreateSourcePolicy | null {
  return value === null ? null : requiredPolicy(value, path, httpStatus);
}

function positiveSafeInteger(value: unknown, path: string, httpStatus: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidResponse(`Task response ${path} must be a positive integer.`, httpStatus);
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, path: string, httpStatus: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidResponse(`Task response ${path} must be a non-negative integer.`, httpStatus);
  }
  return value;
}

function ensureUniqueIds(
  values: readonly { readonly id: string }[],
  message: string,
): void {
  if (new Set(values.map((value) => value.id.toLowerCase())).size !== values.length) {
    throw invalidResponse(message, 200);
  }
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.trim().toLowerCase();
}

function requiredInputUuid(value: string, label: string): string {
  if (!isUuid(value)) {
    throw new Error(`${label} is unavailable.`);
  }
  return value;
}

function isUuid(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) &&
    value !== '00000000-0000-0000-0000-000000000000'
  );
}

function isValidIdempotencyKey(value: string): boolean {
  return /^[\x20-\x7e]{8,128}$/u.test(value);
}

function invalidResponse(message: string, httpStatus: number): TaskCreateResponseError {
  return new TaskCreateResponseError(message, httpStatus);
}
