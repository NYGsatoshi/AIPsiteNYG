import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

interface ProjectCreateEnvelopeDto {
  readonly requestId?: unknown;
  readonly data?: unknown;
  readonly warnings?: unknown;
}

export class QuickResearchCreateResponseError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'QuickResearchCreateResponseError';
  }
}

@Injectable({ providedIn: 'root' })
export class WorkspaceResearchQuickCreateService {
  private readonly http = inject(HttpClient);

  createResearch(workspaceId: string, title: string, idempotencyKey: string): Observable<string> {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedTitle = title.trim();
    if (!normalizedWorkspaceId) {
      throw new Error('Workspace is required.');
    }
    if (!normalizedTitle) {
      throw new Error('Research title is required.');
    }
    if (!idempotencyKey.trim()) {
      throw new Error('Idempotency key is required.');
    }

    return this.http
      .post<unknown>(
        `/api/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/projects`,
        { title: normalizedTitle },
        {
          headers: new HttpHeaders({
            'Idempotency-Key': idempotencyKey,
          }),
          observe: 'response',
          withCredentials: true,
        },
      )
      .pipe(
        map((response) =>
          mapCreatedProjectId(response.status, response.body, normalizedWorkspaceId),
        ),
      );
  }
}

export function mapCreatedProjectId(
  httpStatus: number,
  response: unknown,
  expectedWorkspaceId: string,
): string {
  if (httpStatus !== 201) {
    throw new QuickResearchCreateResponseError(
      'Project create response must use HTTP 201.',
      httpStatus,
    );
  }

  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw invalidCreateResponse('Project create response is invalid.', httpStatus);
  }

  const envelope = response as ProjectCreateEnvelopeDto;
  if (typeof envelope.requestId !== 'string' || envelope.requestId.trim().length === 0) {
    throw invalidCreateResponse('Project create response is missing a requestId.', httpStatus);
  }
  if (!Array.isArray(envelope.warnings)) {
    throw invalidCreateResponse('Project create response warnings must be an array.', httpStatus);
  }
  if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
    throw invalidCreateResponse('Project create response data is invalid.', httpStatus);
  }

  const data = envelope.data as Record<string, unknown>;
  const id = requiredUuid(data['id'], 'data.id', httpStatus);
  const workspaceId = requiredUuid(data['workspaceId'], 'data.workspaceId', httpStatus);
  if (workspaceId.toLowerCase() !== expectedWorkspaceId.trim().toLowerCase()) {
    throw invalidCreateResponse(
      'Project create response belongs to a different Workspace.',
      httpStatus,
    );
  }
  if (data['groupId'] !== null) {
    throw invalidCreateResponse('Quick create response data.groupId must be null.', httpStatus);
  }
  if (data['status'] !== 0) {
    throw invalidCreateResponse('Quick create response data.status must be Planning.', httpStatus);
  }
  if (data['visibility'] !== 1) {
    throw invalidCreateResponse(
      'Quick create response data.visibility must be MembersOnly.',
      httpStatus,
    );
  }
  if (data['activationState'] !== 1) {
    throw invalidCreateResponse(
      'Quick create response data.activationState must be NeverActivated.',
      httpStatus,
    );
  }

  return id;
}

function requiredUuid(value: unknown, path: string, httpStatus: number): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) ||
    value === '00000000-0000-0000-0000-000000000000'
  ) {
    throw invalidCreateResponse(`Project create response ${path} must be a UUID.`, httpStatus);
  }

  return value;
}

function invalidCreateResponse(
  message: string,
  httpStatus: number,
): QuickResearchCreateResponseError {
  return new QuickResearchCreateResponseError(message, httpStatus);
}

export function createQuickResearchIdempotencyKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `workspace-research-${randomUuid}`;
  }

  return `workspace-research-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
