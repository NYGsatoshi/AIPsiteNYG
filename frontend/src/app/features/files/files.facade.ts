import { HttpClient, HttpResponse } from '@angular/common/http';
import { effect, Injectable, InjectionToken, inject, signal, untracked } from '@angular/core';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import {
  AttachmentUploadResponseDto,
  FileDownloadGrantDto,
  FileListItemDto,
  isAllowedUploadFile,
  mapFileListItem,
  PagedResponseDto,
  safeFileNameFromHeader,
  uploadFileTypeMessage,
} from './files.api';
import { FILE_UPLOAD_MAX_BYTES, FilesPageViewModel, FileUploadViewModel, FileViewModel } from './files.types';

export const AIP_FILES_PAGE_MOCK = new InjectionToken<FilesPageViewModel>('AIP_FILES_PAGE_MOCK');

@Injectable({ providedIn: 'root' })
export class FilesFacade {
  private readonly http = inject(HttpClient);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly mockPage = inject(AIP_FILES_PAGE_MOCK, { optional: true });
  private readonly pageState = signal<FilesPageViewModel>(this.mockPage ?? this.emptyPage('Loading files from backend.'));
  private readonly loadingWorkspaceIds = new Set<string>();

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

  uploadFile(file: File): void {
    const workspaceId = this.activeWorkspace.activeWorkspace()?.id;
    const currentUpload = this.pageState().upload;
    if (!workspaceId || currentUpload.state === 'pending' || currentUpload.state === 'progress') {
      return;
    }

    const validation = this.validateFile(file);
    if (validation) {
      this.setUpload(validation);
      return;
    }

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

    this.http
      .post<AttachmentUploadResponseDto>('/api/files', formData, { withCredentials: true })
      .subscribe({
        next: (response) => {
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
          const normalized = normalizeApiError(error);
          this.setUpload({
            state: 'failed',
            canUpload: true,
            selectedFileName: file.name,
            message: normalized.message,
          });
        },
      });
  }

  rejectOversize(fileName: string): void {
    this.setUpload({
      state: 'tooLarge',
      canUpload: this.canUploadNow(),
      selectedFileName: fileName,
      message: `Files larger than ${this.formatBytes(FILE_UPLOAD_MAX_BYTES)} are rejected before upload.`,
    });
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

  private validateFile(file: File): FileUploadViewModel | null {
    if (file.size <= 0) {
      return {
        state: 'failed',
        canUpload: true,
        selectedFileName: file.name,
        message: 'Empty files are not allowed.',
      };
    }

    if (file.size > FILE_UPLOAD_MAX_BYTES) {
      return {
        state: 'tooLarge',
        canUpload: true,
        selectedFileName: file.name,
        message: `Files larger than ${this.formatBytes(FILE_UPLOAD_MAX_BYTES)} are rejected before upload.`,
      };
    }

    if (!isAllowedUploadFile(file)) {
      return {
        state: 'invalidType',
        canUpload: true,
        selectedFileName: file.name,
        message: uploadFileTypeMessage(file),
      };
    }

    return null;
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

  private findFile(fileObjectId: string): FileViewModel | undefined {
    return this.pageState().recentFiles.find((file) => file.canonicalFileId === fileObjectId);
  }

  private emptyPage(subtitle: string, canUpload = true): FilesPageViewModel {
    return {
      title: 'Files',
      subtitle,
      maxUploadBytes: FILE_UPLOAD_MAX_BYTES,
      upload: {
        state: 'idle',
        canUpload,
        message: canUpload ? 'Select a file to upload to the backend.' : 'Workspace context is required before upload.',
      },
      quota: {
        state: 'available',
        usedBytes: 0,
        limitBytes: FILE_UPLOAD_MAX_BYTES,
        message: 'Quota summary is not available in MVP0.',
      },
      recentFiles: [],
      pickerFiles: [],
    };
  }

  private canUploadNow(): boolean {
    return this.pageState().upload.state !== 'pending' && this.activeWorkspace.activeWorkspace()?.id !== undefined;
  }

  private formatBytes(bytes: number): string {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
