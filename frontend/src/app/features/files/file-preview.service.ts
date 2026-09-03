import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { I18nService } from '../../core/i18n/i18n.service';
import { FileDownloadGrantDto } from './files.api';

export interface FilePreviewLoadResult {
  readonly ok: boolean;
  readonly blob: Blob;
  readonly message: string;
}

@Injectable({ providedIn: 'root' })
export class FilePreviewService {
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18nService);

  load(fileObjectId: string): Observable<FilePreviewLoadResult> {
    const expectedFileObjectId = normalizeIdentity(fileObjectId);
    if (!expectedFileObjectId) {
      return of(previewFailure(this.i18n.translate('files.preview.permissionDenied')));
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
            previewFailure(this.i18n.translate('files.preview.contentUnavailable')),
          );
        }

        return this.http.post(`/api/file-download-grants/${grantId}/download`, { token }, {
          observe: 'response',
          responseType: 'blob',
          withCredentials: true,
        }).pipe(
          map((response): FilePreviewLoadResult => response.body
            ? { ok: true, blob: response.body, message: '' }
            : previewFailure(this.i18n.translate('files.preview.contentUnavailable'))),
        );
      }),
      catchError((error: unknown) => {
        const normalized = normalizeApiError(error);
        const message = [401, 403, 404].includes(normalized.httpStatus)
          ? this.i18n.translate('files.preview.permissionDenied')
          : this.i18n.apiErrorMessage(normalized, 'files.preview.contentUnavailable');
        return of<FilePreviewLoadResult>(previewFailure(message));
      }),
    );
  }
}

function previewFailure(message: string): FilePreviewLoadResult {
  // Callers gate on `ok` before reading `blob`. Keeping the field total avoids
  // Angular template/build narrowing differences while preserving fail-closed behavior.
  return { ok: false, blob: new Blob(), message };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeIdentity(value: unknown): string | undefined {
  return stringValue(value)?.toLowerCase();
}
