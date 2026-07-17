import { HttpClient, HttpEventType, HttpResponse } from '@angular/common/http';
import { effect, Injectable, InjectionToken, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import {
  AttachmentUploadResponseDto,
  FileDownloadGrantDto,
  FileListItemDto,
  mapFileListItem,
  PagedResponseDto,
  safeFileNameFromHeader,
} from './files.api';
import { FilesPageViewModel, FileUploadQueueItem, FileUploadViewModel, FileViewModel } from './files.types';

export const AIP_FILES_PAGE_MOCK = new InjectionToken<FilesPageViewModel>('AIP_FILES_PAGE_MOCK');

@Injectable({ providedIn: 'root' })
export class FilesFacade {
  private readonly http = inject(HttpClient);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly mockPage = inject(AIP_FILES_PAGE_MOCK, { optional: true });
  private readonly pageState = signal<FilesPageViewModel>(this.mockPage ?? this.emptyPage('Loading files from backend.'));
  private readonly loadingWorkspaceIds = new Set<string>();
  private readonly pendingUploads = new Map<string, { file: File; subscription: Subscription }>();

  readonly page = this.pageState.asReadonly();

  constructor() {
    if (!this.mockPage) {
      effect(() => {
        const workspace = this.activeWorkspace.activeWorkspace();
        if (!workspace) {
          this.pageState.set(this.emptyPage('Select a workspace before uploading files.', false));
          return;
        }

        untracked(() => this.loadFiles(workspace.id));
      });
    }
  }

  uploadFiles(files: readonly File[]): void {
    for (const file of files) { this.uploadFile(file); }
  }

  uploadFile(file: File): void {
    const workspaceId = this.activeWorkspace.activeWorkspace()?.id;
    const currentUpload = this.pageState().upload;
    if (!workspaceId || currentUpload.state === 'pending' || currentUpload.state === 'progress') {
      return;
    }

    if (!file.name || file.size <= 0) { this.setUpload({ state: 'failed', canUpload: true, selectedFileName: file.name, message: 'Select a non-empty file.' }); return; }
    const clientRequestId = crypto.randomUUID();
    this.updateQueue({ clientRequestId, fileName: file.name, state: 'pending' });

    this.setUpload({
      state: 'pending',
      canUpload: false,
      selectedFileName: file.name,
      message: 'Uploading file to backend.',
    });

    const formData = new FormData();
    formData.append('OwnerType', 'Workspace');
    formData.append('OwnerId', workspaceId);
    formData.append('File', file);

    const subscription = this.http
      .post<AttachmentUploadResponseDto>('/api/files', formData, { withCredentials: true, observe: 'events', reportProgress: true })
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.Sent) { this.updateQueue({ clientRequestId, fileName: file.name, state: 'uploading' }); return; }
          if (event.type === HttpEventType.UploadProgress) { this.setUpload({ state: 'progress', canUpload: false, selectedFileName: file.name, progressPercent: event.total ? Math.round(event.loaded / event.total * 100) : undefined, message: 'Uploading file to backend.' }); return; }
          if (event.type !== HttpEventType.Response) { return; }
          const response = event.body ?? {};
          this.pendingUploads.delete(clientRequestId);
          this.updateQueue({ clientRequestId, fileName: stringValue(response.originalFileName) ?? file.name, state: 'succeeded' });
          this.setUpload({
            state: 'succeeded',
            canUpload: true,
            selectedFileName: stringValue(response.originalFileName) ?? file.name,
            message: 'Upload accepted by backend.',
          });
          this.loadingWorkspaceIds.delete(workspaceId);
          this.loadFiles(workspaceId);
        },
        error: (error: unknown) => {
          this.pendingUploads.delete(clientRequestId);
          const normalized = normalizeApiError(error);
          this.updateQueue({ clientRequestId, fileName: file.name, state: 'failed', message: normalized.message });
          this.setUpload({
            state: 'failed',
            canUpload: true,
            selectedFileName: file.name,
            message: normalized.message,
          });
        },
      });
    this.pendingUploads.set(clientRequestId, { file, subscription });
  }

  cancelUpload(clientRequestId: string): void {
    const pending = this.pendingUploads.get(clientRequestId);
    if (!pending) { return; }
    pending.subscription.unsubscribe();
    this.pendingUploads.delete(clientRequestId);
    this.updateQueue({ clientRequestId, fileName: pending.file.name, state: 'cancelled' });
    this.setUpload({ state: 'cancelled', canUpload: this.canUploadNow(), selectedFileName: pending.file.name, message: 'Upload cancelled locally.' });
  }

  retryUpload(clientRequestId: string): void {
    const item = this.pendingUploads.get(clientRequestId);
    if (item) { this.uploadFile(item.file); }
  }

  downloadFile(fileObjectId: string): void {
    if (!fileObjectId || this.mockPage) {
      return;
    }

    const file = this.findFile(fileObjectId);
    if (!file || file.downloadState === 'pending') {
      return;
    }

    this.updateFileDownload(fileObjectId, {
      downloadState: 'pending',
      downloadMessage: 'Authorizing download.',
    });

    this.http
      .post<FileDownloadGrantDto>(
        `/api/files/${fileObjectId}/download-grants`,
        { purpose: 'files-page-download' },
        { withCredentials: true },
      )
      .subscribe({
        next: (grant) => this.downloadWithGrant(fileObjectId, grant),
        error: (error: unknown) => {
          const normalized = normalizeApiError(error);
          this.updateFileDownload(fileObjectId, {
            downloadState: 'failed',
            downloadMessage: normalized.httpStatus === 403 ? 'Download denied.' : normalized.message,
          });
        },
      });
  }

  private loadFiles(workspaceId: string): void {
    if (this.loadingWorkspaceIds.has(workspaceId)) {
      return;
    }

    this.loadingWorkspaceIds.add(workspaceId);
    const currentUpload = this.pageState().upload;
    this.http
      .get<PagedResponseDto<FileListItemDto>>('/api/files', {
        params: { workspaceId, page: 1, pageSize: 20 },
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          this.loadingWorkspaceIds.delete(workspaceId);
          const files = (response.items ?? []).map((item) => mapFileListItem(item)).filter((file) => file.id.length > 0);
          this.pageState.set({
            ...this.emptyPage(files.length === 0 ? 'No files returned by backend.' : 'Files are loaded from backend.'),
            upload: currentUpload,
            uploadQueue: this.pageState().uploadQueue,
            recentFiles: files,
            pickerFiles: files,
          });
        },
        error: (error: unknown) => {
          this.loadingWorkspaceIds.delete(workspaceId);
          const normalized = normalizeApiError(error);
          this.pageState.set({
            ...this.emptyPage(normalized.message),
            upload: { ...currentUpload, canUpload: true },
            uploadQueue: this.pageState().uploadQueue,
          });
        },
      });
  }

  private downloadWithGrant(fileObjectId: string, grant: FileDownloadGrantDto): void {
    const grantId = stringValue(grant.fileDownloadGrantId);
    const token = stringValue(grant.token);
    if (!grantId || !token) {
      this.updateFileDownload(fileObjectId, {
        downloadState: 'failed',
        downloadMessage: 'Download grant response was incomplete.',
      });
      return;
    }

    this.http
      .post(`/api/file-download-grants/${grantId}/download`, { token }, {
        observe: 'response',
        responseType: 'blob',
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          const fileName = safeFileNameFromHeader(
            response.headers.get('content-disposition'),
            this.findFile(fileObjectId)?.originalFileName ?? 'download',
          );
          this.saveBlob(response, fileName);
          this.updateFileDownload(fileObjectId, {
            downloadState: 'succeeded',
            downloadMessage: 'Download started.',
          });
        },
        error: (error: unknown) => {
          const normalized = normalizeApiError(error);
          this.updateFileDownload(fileObjectId, {
            downloadState: 'failed',
            downloadMessage: normalized.httpStatus === 403 ? 'Download denied.' : normalized.message,
          });
        },
      });
  }

  private saveBlob(response: HttpResponse<Blob>, fileName: string): void {
    const blob = response.body;
    if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  private setUpload(upload: FileUploadViewModel): void {
    this.pageState.update((page) => ({ ...page, upload }));
  }

  private updateFileDownload(fileObjectId: string, patch: Pick<FileViewModel, 'downloadState' | 'downloadMessage'>): void {
    this.pageState.update((page) => {
      const files = page.recentFiles.map((file) =>
        file.canonicalFileId === fileObjectId ? { ...file, ...patch } : file,
      );
      return {
        ...page,
        recentFiles: files,
        pickerFiles: page.pickerFiles.map((file) =>
          file.canonicalFileId === fileObjectId ? { ...file, ...patch } : file,
        ),
      };
    });
  }

  private updateQueue(item: FileUploadQueueItem): void {
    this.pageState.update((page) => ({ ...page, uploadQueue: [...page.uploadQueue.filter((queued) => queued.clientRequestId !== item.clientRequestId), item] }));
  }

  private findFile(fileObjectId: string): FileViewModel | undefined {
    return this.pageState().recentFiles.find((file) => file.canonicalFileId === fileObjectId);
  }

  private emptyPage(subtitle: string, canUpload = true): FilesPageViewModel {
    return {
      title: 'Files',
      subtitle,
      upload: {
        state: 'idle',
        canUpload,
        message: canUpload ? 'Select a file to upload to the backend.' : 'Workspace context is required before upload.',
      },
      uploadQueue: [],
      quota: {
        state: 'available',
        usedBytes: 0,
        limitBytes: 0,
        message: 'Quota summary is not available in MVP0.',
      },
      recentFiles: [],
      pickerFiles: [],
    };
  }

  private canUploadNow(): boolean {
    return this.pageState().upload.state !== 'pending' && this.activeWorkspace.activeWorkspace()?.id !== undefined;
  }

}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
