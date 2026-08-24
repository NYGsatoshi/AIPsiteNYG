import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export type ProjectVisibility = 0 | 1 | 2;

export const PROJECT_VISIBILITY_WORKSPACE_VISIBLE: ProjectVisibility = 0;
export const PROJECT_VISIBILITY_MEMBERS_ONLY: ProjectVisibility = 1;
export const PROJECT_VISIBILITY_RESTRICTED: ProjectVisibility = 2;

export interface ProjectCreateGroupOption {
  readonly id: string;
  readonly name: string;
}

export interface ProjectCreateOptions {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly canCreateUngrouped: boolean;
  readonly allowedVisibilities: readonly ProjectVisibility[];
  readonly groups: readonly ProjectCreateGroupOption[];
}

export interface ProjectCreateInput {
  readonly title: string;
  readonly description: string | null;
  readonly groupId: string | null;
  readonly visibility: ProjectVisibility;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

export interface ProjectCreateRequestDto {
  readonly title: string;
  readonly description: string | null;
  readonly groupId: string | null;
  readonly visibility: ProjectVisibility;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

export interface CreatedProjectDto {
  readonly id: string;
  readonly workspaceId: string;
  readonly groupId: string | null;
  readonly ownerUserId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: 0;
  readonly visibility: ProjectVisibility;
  readonly activationState: 1;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly versionNo: number;
  readonly createdAt: string;
}

export interface ProjectCreateSuccess {
  readonly requestId: string;
  readonly data: CreatedProjectDto;
  readonly warnings: readonly unknown[];
}

export interface CreatedProjectConfirmation {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: number;
  readonly activationState: 1 | 2;
}

export class ProjectCreateResponseError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'ProjectCreateResponseError';
  }
}

@Injectable({ providedIn: 'root' })
export class ProjectCreateApi {
  private readonly http = inject(HttpClient);

  getOptions(workspaceId: string): Observable<ProjectCreateOptions> {
    const expectedWorkspaceId = requiredInputUuid(workspaceId, 'Workspace');
    return this.http
      .get<unknown>(
        `/api/workspaces/${encodeURIComponent(expectedWorkspaceId)}/projects/create-options`,
        { withCredentials: true },
      )
      .pipe(map((response) => mapProjectCreateOptions(response, expectedWorkspaceId)));
  }

  createProject(
    workspaceId: string,
    request: ProjectCreateRequestDto,
    idempotencyKey: string,
  ): Observable<ProjectCreateSuccess> {
    const expectedWorkspaceId = requiredInputUuid(workspaceId, 'Workspace');
    if (!idempotencyKey.trim()) {
      throw new Error('Idempotency key is required.');
    }

    return this.http
      .post<unknown>(
        `/api/workspaces/${encodeURIComponent(expectedWorkspaceId)}/projects`,
        request,
        {
          headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }),
          observe: 'response',
          withCredentials: true,
        },
      )
      .pipe(
        map((response) =>
          mapProjectCreateSuccess(response.status, response.body, expectedWorkspaceId, request),
        ),
      );
  }

  confirmCreatedProject(
    projectId: string,
    expectedWorkspaceId: string,
  ): Observable<CreatedProjectConfirmation> {
    const expectedProjectId = requiredInputUuid(projectId, 'Project');
    const workspaceId = requiredInputUuid(expectedWorkspaceId, 'Workspace');
    return this.http
      .get<unknown>(`/api/projects/${encodeURIComponent(expectedProjectId)}`, {
        withCredentials: true,
      })
      .pipe(
        map((response) => mapCreatedProjectConfirmation(response, expectedProjectId, workspaceId)),
      );
  }
}

export function canonicalizeProjectCreateInput(input: ProjectCreateInput): ProjectCreateRequestDto {
  return {
    title: input.title.trim(),
    description: optionalString(input.description),
    groupId: optionalString(input.groupId),
    visibility: input.visibility,
    startDate: optionalString(input.startDate),
    endDate: optionalString(input.endDate),
  };
}

export function mapProjectCreateOptions(
  value: unknown,
  expectedWorkspaceId: string,
): ProjectCreateOptions {
  const envelope = recordValue(value, 'Project create options response');
  const requestId = requiredString(envelope['requestId'], 'requestId', 200);
  if (!Array.isArray(envelope['warnings'])) {
    throw invalidResponse('Project create options response warnings must be an array.', 200);
  }

  const data = recordValue(envelope['data'], 'Project create options response data');
  const workspaceId = requiredUuid(data['workspaceId'], 'data.workspaceId', 200);
  if (!sameUuid(workspaceId, expectedWorkspaceId)) {
    throw invalidResponse('Project create options belong to a different Workspace.', 200);
  }
  if (typeof data['canCreateUngrouped'] !== 'boolean') {
    throw invalidResponse('Project create options data.canCreateUngrouped must be a boolean.', 200);
  }
  if (!Array.isArray(data['allowedVisibilities'])) {
    throw invalidResponse('Project create options data.allowedVisibilities must be an array.', 200);
  }

  const allowedVisibilities = data['allowedVisibilities'].map((item) =>
    requiredVisibility(item, 'data.allowedVisibilities', 200),
  );
  if (!Array.isArray(data['groups'])) {
    throw invalidResponse('Project create options data.groups must be an array.', 200);
  }
  const groups = data['groups'].map((item, index) => {
    const group = recordValue(item, `Project create options group ${index}`);
    return {
      id: requiredUuid(group['id'], `data.groups[${index}].id`, 200),
      name: requiredString(group['name'], `data.groups[${index}].name`, 200),
    };
  });
  if (new Set(groups.map((group) => group.id.toLowerCase())).size !== groups.length) {
    throw invalidResponse('Project create options contain duplicate Groups.', 200);
  }

  const hasCreateMode = data['canCreateUngrouped'] || groups.length > 0;
  const uniqueVisibilities = new Set(allowedVisibilities).size === allowedVisibilities.length;
  if (
    !uniqueVisibilities ||
    (hasCreateMode &&
      (allowedVisibilities.length === 0 ||
        !allowedVisibilities.includes(PROJECT_VISIBILITY_MEMBERS_ONLY))) ||
    (!hasCreateMode && allowedVisibilities.length > 0)
  ) {
    throw invalidResponse('Project create options contain an inconsistent visibility grant.', 200);
  }

  return {
    requestId,
    workspaceId,
    canCreateUngrouped: data['canCreateUngrouped'],
    allowedVisibilities,
    groups,
  };
}

/**
 * Accepts only the authoritative canonical HTTP 201 response. Any malformed
 * success is uncertain delivery and must retain the caller's idempotency key.
 */
export function mapProjectCreateSuccess(
  httpStatus: number,
  value: unknown,
  expectedWorkspaceId: string,
  expectedRequest: ProjectCreateRequestDto,
): ProjectCreateSuccess {
  if (httpStatus !== 201) {
    throw invalidResponse('Project create response must use HTTP 201.', httpStatus);
  }

  const envelope = recordValue(value, 'Project create response', httpStatus);
  const requestId = requiredString(envelope['requestId'], 'requestId', httpStatus);
  if (!Array.isArray(envelope['warnings'])) {
    throw invalidResponse('Project create response warnings must be an array.', httpStatus);
  }

  const data = recordValue(envelope['data'], 'Project create response data', httpStatus);
  const id = requiredUuid(data['id'], 'data.id', httpStatus);
  const workspaceId = requiredUuid(data['workspaceId'], 'data.workspaceId', httpStatus);
  if (!sameUuid(workspaceId, expectedWorkspaceId)) {
    throw invalidResponse('Project create response belongs to a different Workspace.', httpStatus);
  }

  const groupId = nullableUuid(data['groupId'], 'data.groupId', httpStatus);
  if (!sameNullableUuid(groupId, expectedRequest.groupId)) {
    throw invalidResponse('Project create response Group does not match the request.', httpStatus);
  }
  const ownerUserId = requiredUuid(data['ownerUserId'], 'data.ownerUserId', httpStatus);
  const title = requiredString(data['title'], 'data.title', httpStatus);
  if (title !== expectedRequest.title) {
    throw invalidResponse('Project create response title does not match the request.', httpStatus);
  }
  const description = nullableString(data['description'], 'data.description', httpStatus);
  if (description !== expectedRequest.description) {
    throw invalidResponse(
      'Project create response description does not match the request.',
      httpStatus,
    );
  }
  if (data['status'] !== 0) {
    throw invalidResponse('Project create response status must be Planning.', httpStatus);
  }
  const visibility = requiredVisibility(data['visibility'], 'data.visibility', httpStatus);
  if (visibility !== expectedRequest.visibility) {
    throw invalidResponse(
      'Project create response visibility does not match the request.',
      httpStatus,
    );
  }
  if (data['activationState'] !== 1) {
    throw invalidResponse(
      'Project create response activationState must be NeverActivated.',
      httpStatus,
    );
  }

  const startDate = nullableDate(data['startDate'], 'data.startDate', httpStatus);
  const endDate = nullableDate(data['endDate'], 'data.endDate', httpStatus);
  if (startDate !== expectedRequest.startDate || endDate !== expectedRequest.endDate) {
    throw invalidResponse('Project create response dates do not match the request.', httpStatus);
  }
  const versionNo = positiveSafeInteger(data['versionNo'], 'data.versionNo', httpStatus);
  const createdAt = requiredTimestamp(data['createdAt'], 'data.createdAt', httpStatus);

  return {
    requestId,
    data: {
      id,
      workspaceId,
      groupId,
      ownerUserId,
      title,
      description,
      status: 0,
      visibility,
      activationState: 1,
      startDate,
      endDate,
      versionNo,
      createdAt,
    },
    warnings: envelope['warnings'],
  };
}

export function mapCreatedProjectConfirmation(
  value: unknown,
  expectedProjectId: string,
  expectedWorkspaceId: string,
): CreatedProjectConfirmation {
  const project = recordValue(value, 'Created Project confirmation');
  const id = requiredUuid(project['id'], 'id', 200);
  const workspaceId = requiredUuid(project['workspaceId'], 'workspaceId', 200);
  if (!sameUuid(id, expectedProjectId) || !sameUuid(workspaceId, expectedWorkspaceId)) {
    throw invalidResponse('Created Project confirmation belongs to a different scope.', 200);
  }

  const status = project['status'];
  const activationState = project['activationState'];
  const isDraft = status === 0 && activationState === 1;
  const isActivated =
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 1 &&
    status <= 5 &&
    activationState === 2;
  if (!isDraft && !isActivated) {
    throw invalidResponse(
      'Created Project confirmation must be an authoritative Draft or activated Project.',
      200,
    );
  }

  return {
    id,
    workspaceId,
    status,
    activationState,
  } as CreatedProjectConfirmation;
}

export function projectVisibilityLabel(visibility: ProjectVisibility): string {
  switch (visibility) {
    case PROJECT_VISIBILITY_WORKSPACE_VISIBLE:
      return 'Workspace visible';
    case PROJECT_VISIBILITY_MEMBERS_ONLY:
      return 'Members only';
    case PROJECT_VISIBILITY_RESTRICTED:
      return 'Restricted';
  }

  return 'Unavailable';
}

function requiredInputUuid(value: string, label: string): string {
  if (!isUuid(value)) {
    throw new Error(`${label} is unavailable.`);
  }
  return value;
}

function recordValue(value: unknown, label: string, httpStatus = 200): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse(`${label} must be an object.`, httpStatus);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string, httpStatus: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidResponse(`Project response ${path} must be a non-empty string.`, httpStatus);
  }
  return value;
}

function nullableString(value: unknown, path: string, httpStatus: number): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw invalidResponse(`Project response ${path} must be a string or null.`, httpStatus);
}

function requiredUuid(value: unknown, path: string, httpStatus: number): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw invalidResponse(`Project response ${path} must be a UUID.`, httpStatus);
  }
  return value;
}

function nullableUuid(value: unknown, path: string, httpStatus: number): string | null {
  return value === null ? null : requiredUuid(value, path, httpStatus);
}

function requiredVisibility(value: unknown, path: string, httpStatus: number): ProjectVisibility {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw invalidResponse(`Project response ${path} is not a supported visibility.`, httpStatus);
  }
  return value;
}

function nullableDate(value: unknown, path: string, httpStatus: number): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw invalidResponse(`Project response ${path} must be an ISO date or null.`, httpStatus);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalidResponse(`Project response ${path} must be a valid date.`, httpStatus);
  }
  return value;
}

function positiveSafeInteger(value: unknown, path: string, httpStatus: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidResponse(`Project response ${path} must be a positive integer.`, httpStatus);
  }
  return value;
}

function requiredTimestamp(value: unknown, path: string, httpStatus: number): string {
  const timestamp = requiredString(value, path, httpStatus);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw invalidResponse(`Project response ${path} must be an ISO timestamp.`, httpStatus);
  }
  return timestamp;
}

function optionalString(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function isUuid(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) &&
    value !== '00000000-0000-0000-0000-000000000000'
  );
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.trim().toLowerCase();
}

function sameNullableUuid(left: string | null, right: string | null): boolean {
  return left === null || right === null
    ? left === right
    : left.toLowerCase() === right.toLowerCase();
}

function invalidResponse(message: string, httpStatus: number): ProjectCreateResponseError {
  return new ProjectCreateResponseError(message, httpStatus);
}
