import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { FileDownloadGrantDto } from './files.api';

export type FilePreviewLoadResult =
  | { readonly ok: true; readonly blob: Blob }
  | { readonly ok: false; readonly message: string };

@Injectable({ providedIn: 'root' })
export class FilePreviewService {
  private readonly http = inject(HttpClient);

  load(fileObjectId: string): Observable<FilePreviewLoadResult> {
    const expectedFileObjectId = normalizeIdentity(fileObjectId);
    if (!expectedFileObjectId) {
      return of(previewFailure('Preview is not available for this file.'));
    }

    return this.http.post<FileDownloadGrantDto>(
      `/api/files/${fileObjectId}/download-grants`,
      { purpose: 'files-page-preview' },
      { withCredentials: true },
    ).pipe(
      switchMap((grant) => {
        const grantId = stringValue(grant.fileDownloadGrantId);
        const grantedFileObjectId = normalizeIdentity(grant.fileObjectId);
        const token = stringValue(grant.token);
        if (!grantId || grantedFileObjectId !== expectedFileObjectId || !token) {
          return of<FilePreviewLoadResult>(
            previewFailure('Preview authorization response was incomplete or mismatched.'),
          );
        }

        return this.http.post(`/api/file-download-grants/${grantId}/download`, { token }, {
          observe: 'response',
          responseType: 'blob',
          withCredentials: true,
        }).pipe(
          map((response): FilePreviewLoadResult => response.body
            ? { ok: true, blob: response.body }
            : previewFailure('Preview content was empty.')),
        );
      }),
      catchError((error: unknown) => {
        const normalized = normalizeApiError(error);
        const message = [401, 403, 404].includes(normalized.httpStatus)
          ? 'Preview is not available for this file.'
          : normalized.message;
        return of<FilePreviewLoadResult>(previewFailure(message));
      }),
    );
  }
}

function previewFailure(message: string): FilePreviewLoadResult {
  return { ok: false, message };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeIdentity(value: unknown): string | undefined {
  return stringValue(value)?.toLowerCase();
}
