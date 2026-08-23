import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

interface ProjectCreateEnvelopeDto {
  readonly data?: {
    readonly id?: unknown;
  } | null;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceResearchQuickCreateService {
  private readonly http = inject(HttpClient);

  createResearch(
    workspaceId: string,
    title: string,
    idempotencyKey: string,
  ): Observable<string> {
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
        },
      )
      .pipe(map(mapCreatedProjectId));
  }
}

export function mapCreatedProjectId(response: unknown): string {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Project create response is invalid.');
  }

  const envelope = response as ProjectCreateEnvelopeDto;
  const id = envelope.data?.id;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Project create response is missing an id.');
  }

  return id;
}

export function createQuickResearchIdempotencyKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `workspace-research-${randomUuid}`;
  }

  return `workspace-research-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
