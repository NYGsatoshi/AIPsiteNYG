import { HttpClient, HttpEventType, HttpResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { catchError, concatMap, finalize, from, map, of, Subscription, toArray } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import {
  AttachmentUploadResponseDto,
  FileDownloadGrantDto,
  FileListItemDto,
  mapFileListItem,
  PagedResponseDto,
  safeFileNameFromHeader,
} from './files.api';
import {
  FileDeleteViewModel,
  FileDownloadState,
  FilesPageViewModel,
  FileUploadQueueItem,
  FileUploadViewModel,
  FileViewModel,
  TaskFilePickerState,
} from './files.types';

export const AIP_FILES_PAGE_MOCK = new InjectionToken<FilesPageViewModel>('AIP_FILES_PAGE_MOCK');

const FILES_PAGE_SIZE = 50;

export interface AttachmentDownloadContext {
  /** Prevent an obsolete Task route from receiving a completion callback. */
  readonly isCurrent?: () => boolean;
  readonly onState?: (state: FileDownloadState, message: string) => void;
  readonly onPermissionDenied?: () => void;
}

@Injectable({ providedIn: 'root' })
export class FilesFacade {
  private readonly http = inject(HttpClient);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly realtime = inject(RealtimeFacade);
  private readonly mockPage = inject(AIP_FILES_PAGE_MOCK, { optional: true });
  private readonly pageState = signal<FilesPageViewModel>(this.mockPage ?? this.emptyPage('Loading files from backend.'));
  private readonly deleteStateSignal = signal<FileDeleteViewModel>(this.emptyDeleteState());
  private readonly inventoryRevisionSignal = signal(0);
  /** Task detail owns this independent query; it must never alter Files-page workspace state. */
  private readonly pickerState = signal<TaskFilePickerState>(this.emptyPickerState());
  private pageWorkspaceId: string | null = null;
  private pageGeneration = 0;
  private pickerWorkspaceId: string | null = null;
  private pickerGeneration = 0;
  private pickerRequest: Subscription | null = null;
  private readonly attachmentDownloads = new Map<string, Subscription>();
  private readonly fileDownloads = new Map<string, Subscription>();
  private readonly pageRequests = new Set<Subscription>();
  private readonly loadingWorkspaceIds = new Set<string>();
  private readonly pendingUploads = new Map<string, { file: File; subscription: Subscription }>();
  private deleteRequest: Subscription | null = null;
  private refreshAfterMutation = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  readonly page = this.pageState.asReadonly();
  readonly deleteState = this.deleteStateSignal.asReadonly();
  /** Changes only when the server inventory is replaced or protected state is cleared. */
  readonly inventoryRevision = this.inventoryRevisionSignal.asReadonly();
  readonly pickerStateForTask = this.pickerState.asReadonly();
  /** Compatibility projection for existing consumers; Task detail must consume pickerStateForTask. */
  readonly pickerFiles = () => this.pickerState().files;

  constructor() {
    this.realtime.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event));
    if (!this.mockPage) {
      this.realtime.registerProtectedStateClearer?.('files', () => this.clearProtectedState());
    }
  }

  /** The Files page opts into its workspace inventory; other consumers must not prefetch it. */
  loadPageFilesForWorkspace(workspaceId: string | null | undefined): void {
    if (this.mockPage) {
      return;
    }
    if (!workspaceId) {
      this.cancelDeleteOperation();
      this.invalidatePageRequests();
      this.pageWorkspaceId = null;
      this.pageState.set(this.emptyPage('Select a workspace before uploading files.', false));
      this.inventoryRevisionSignal.update((revision) => revision + 1);
      return;
    }
    if (this.pageWorkspaceId === workspaceId) {
      return;
    }
    this.cancelDeleteOperation();
    this.invalidatePageRequests();
    this.pageWorkspaceId = workspaceId;
    this.loadFiles(workspaceId, 1, FILES_PAGE_SIZE);
  }

  goToPage(page: number): void {
    if (this.mockPage || !this.pageWorkspaceId) {
      return;
    }

    const state = this.pageState();
    const totalPages = Math.max(1, Math.ceil(state.totalCount / Math.max(1, state.pageSize)));
    const requestedPage = Number.isFinite(page) ? Math.floor(page) : state.page;
    const targetPage = Math.max(1, Math.min(requestedPage, totalPages));
    if (targetPage === state.page) {
      return;
    }

    this.loadFiles(this.pageWorkspaceId, targetPage, state.pageSize);
  }

  uploadFiles(files: readonly File[]): void {
    for (const file of files) { this.uploadFile(file); }
  }

  uploadFile(file: File): void {
    const workspaceId = this.activeWorkspace.activeWorkspace()?.id;
    const generation = this.pageGeneration;
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
          if (generation !== this.pageGeneration) { return; }
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
          this.loadFiles(workspaceId, 1, this.pageState().pageSize);
          this.reconcileAfterMutation(workspaceId);
        },
        error: (error: unknown) => {
          if (generation !== this.pageGeneration) { return; }
          this.pendingUploads.delete(clientRequestId);
          const normalized = normalizeApiError(error);
          this.updateQueue({ clientRequestId, fileName: file.name, state: 'failed', message: normalized.message });
          this.setUpload({
            state: 'failed',
            canUpload: true,
            selectedFileName: file.name,
            message: normalized.message,
          });
          this.reconcileAfterMutation(workspaceId);
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

    const generation = this.pageGeneration;
    const operation = new Subscription();
    this.fileDownloads.set(fileObjectId, operation);
    const grantRequest = this.http.post<FileDownloadGrantDto>(
        `/api/files/${fileObjectId}/download-grants`,
        { purpose: 'files-page-download' },
        { withCredentials: true },
      )
      .subscribe({
        next: (grant) => {
          if (!this.isCurrentPageOperation(generation, fileObjectId)) { return; }
          this.downloadWithGrant(fileObjectId, grant, generation, operation);
        },
        error: (error: unknown) => {
          if (!this.isCurrentPageOperation(generation, fileObjectId)) { return; }
          const normalized = normalizeApiError(error);
          this.updateFileDownload(fileObjectId, {
            downloadState: 'failed',
            downloadMessage: normalized.httpStatus === 403 ? 'Download denied.' : normalized.message,
          });
          operation.unsubscribe();
        },
      });
    operation.add(grantRequest);
    operation.add(() => this.fileDownloads.delete(fileObjectId));
  }

  /**
   * Uses the existing single-file mutation contract. Requests are intentionally
   * serial and independent; callers must never present this as an atomic batch.
   */
  deleteFiles(files: readonly FileViewModel[], onComplete?: () => void): void {
    if (this.mockPage || this.deleteRequest || !this.pageWorkspaceId || files.length === 0) {
      return;
    }

    const uniqueFiles = [...new Map(files.map((file) => [file.canonicalFileId, file])).values()]
      .filter((file): file is FileViewModel & { canonicalFileId: string } =>
        typeof file.canonicalFileId === 'string' && file.canonicalFileId.length > 0);
    if (uniqueFiles.length !== files.length || uniqueFiles.some((file) => file.canDelete !== true)) {
      this.deleteStateSignal.set({
        state: 'failed',
        message: 'The selected files are not authorized for deletion.',
        succeededCount: 0,
        failedCount: files.length,
      });
      return;
    }

    const workspaceId = this.pageWorkspaceId;
    const generation = this.pageGeneration;
    this.deleteStateSignal.set({
      state: 'pending',
      message: uniqueFiles.length === 1
        ? 'Deleting the selected file.'
        : `Deleting ${uniqueFiles.length} files one at a time.`,
      succeededCount: 0,
      failedCount: 0,
    });

    const request = from(uniqueFiles).pipe(
      concatMap((file) => this.http
        .delete<void>(`/api/files/${file.canonicalFileId}`, { withCredentials: true })
        .pipe(
          map(() => ({ file, succeeded: true as const })),
          catchError(() => of({ file, succeeded: false as const })),
        )),
      toArray(),
    ).subscribe((results) => {
      if (generation !== this.pageGeneration || workspaceId !== this.pageWorkspaceId) {
        return;
      }

      const succeeded = results.filter((result) => result.succeeded);
      const failedCount = results.length - succeeded.length;
      const succeededIds = new Set(succeeded.map((result) => result.file.canonicalFileId));
      if (succeededIds.size > 0) {
        this.pageState.update((page) => ({
          ...page,
          recentFiles: page.recentFiles.filter((file) => !file.canonicalFileId || !succeededIds.has(file.canonicalFileId)),
          pickerFiles: page.pickerFiles.filter((file) => !file.canonicalFileId || !succeededIds.has(file.canonicalFileId)),
          totalCount: Math.max(0, page.totalCount - succeededIds.size),
        }));
      }

      if (failedCount === 0) {
        this.deleteStateSignal.set({
          state: 'succeeded',
          message: results.length === 1
            ? 'The file was deleted.'
            : `${results.length} files were deleted one at a time.`,
          succeededCount: results.length,
          failedCount: 0,
        });
      } else if (succeeded.length > 0) {
        this.deleteStateSignal.set({
          state: 'partial',
          message: `${succeeded.length} of ${results.length} files were deleted. ${failedCount} could not be deleted. Each deletion was processed separately; this was not an atomic batch.`,
          succeededCount: succeeded.length,
          failedCount,
        });
      } else {
        this.deleteStateSignal.set({
          state: 'failed',
          message: 'No files were deleted. The server did not authorize or complete any selected deletion.',
          succeededCount: 0,
          failedCount,
        });
      }

      onComplete?.();
      const current = this.pageState();
      this.loadFiles(workspaceId, current.page, current.pageSize);
    });
    this.deleteRequest = request;
    request.add(() => {
      if (this.deleteRequest === request) {
        this.deleteRequest = null;
      }
    });
  }

  loadPickerFilesForWorkspace(workspaceId: string): void {
    if (!workspaceId || this.mockPage) { this.clearPickerFiles(); return; }
    if (this.pickerWorkspaceId === workspaceId && (this.pickerRequest || this.pickerState().status !== 'idle')) return;
    this.pickerGeneration++;
    const generation = this.pickerGeneration;
    this.pickerWorkspaceId = workspaceId;
    this.pickerRequest?.unsubscribe();
    this.pickerState.set({ ...this.emptyPickerState(workspaceId), status: 'loading' });
    this.loadPickerPage(workspaceId, 1, generation, true);
  }

  loadMorePickerFiles(): void {
    const state = this.pickerState();
    if (!state.workspaceId || !state.hasMore || this.pickerRequest) return;
    this.loadPickerPage(state.workspaceId, state.page + 1, this.pickerGeneration, false);
  }

  retryPickerFiles(): void {
    const state = this.pickerState();
    if (!state.workspaceId || this.pickerRequest) return;
    this.loadPickerPage(state.workspaceId, state.failedPage ?? 1, this.pickerGeneration, (state.failedPage ?? 1) === 1);
  }

  clearPickerFiles(): void {
    this.pickerGeneration++;
    this.pickerRequest?.unsubscribe();
    this.pickerRequest = null;
    this.pickerWorkspaceId = null;
    this.pickerState.set(this.emptyPickerState());
  }

  private loadPickerPage(workspaceId: string, page: number, generation: number, replace: boolean): void {
    const before = this.pickerState();
    this.pickerRequest = this.http.get<PagedResponseDto<FileListItemDto>>('/api/files', {
      params: { workspaceId, page, pageSize: before.pageSize || 20 }, withCredentials: true
    }).pipe(finalize(() => {
      if (generation === this.pickerGeneration) this.pickerRequest = null;
    })).subscribe({
      next: response => {
        if (generation !== this.pickerGeneration || this.pickerWorkspaceId !== workspaceId) return;
        const incoming = (response.items ?? []).map(mapFileListItem).filter(file => file.id.length > 0);
        const existing = replace ? [] : this.pickerState().files;
        const ids = new Set(existing.map(file => file.id));
        const files = [...existing, ...incoming.filter(file => !ids.has(file.id) && (ids.add(file.id), true))];
        this.pickerState.set({ status: files.length ? 'ready' : 'empty', workspaceId, files, page: numberValue(response.page) || page, pageSize: numberValue(response.pageSize) || before.pageSize || 20, totalCount: numberValue(response.totalCount) || files.length, hasMore: response.hasMore === true });
      },
      error: error => {
        if (generation !== this.pickerGeneration || this.pickerWorkspaceId !== workspaceId) return;
        const normalized = normalizeApiError(error);
        const current = this.pickerState();
        this.pickerState.set({ ...current, workspaceId, status: normalized.httpStatus === 401 || normalized.httpStatus === 403 ? 'permissionDenied' : 'error', message: normalized.message, requestId: normalized.requestId, failedPage: page });
      }
    });
  }

  /** Uses the canonical attachment grant boundary; grant tokens never enter signal state. */
  downloadAttachment(attachmentId: string, fallbackFileName: string, context: AttachmentDownloadContext = {}): Subscription | null {
    if (!attachmentId || this.mockPage || this.attachmentDownloads.has(attachmentId)) return null;
    const operation = new Subscription();
    this.attachmentDownloads.set(attachmentId, operation);
    const report = (state: FileDownloadState, message: string) => {
      if (context.isCurrent?.() !== false) context.onState?.(state, message);
    };
    const denied = () => { if (context.isCurrent?.() !== false) context.onPermissionDenied?.(); };
    report('pending', 'Authorizing download.');
    const grantRequest = this.http.post<FileDownloadGrantDto>(`/api/attachments/${attachmentId}/download-grants`, { purpose: 'task-detail-download' }, { withCredentials: true }).subscribe({
      next: grant => {
        const grantId = stringValue(grant.fileDownloadGrantId);
        const token = stringValue(grant.token);
        if (!grantId || !token) { report('failed', 'Download grant response was incomplete.'); operation.unsubscribe(); return; }
        const downloadRequest = this.http.post(`/api/attachment-download-grants/${grantId}/download`, { token }, { observe: 'response', responseType: 'blob', withCredentials: true }).subscribe({
          next: response => {
            if (context.isCurrent?.() === false) return;
            this.saveBlob(response, safeFileNameFromHeader(response.headers.get('content-disposition'), fallbackFileName));
            report('succeeded', 'Download started.');
            operation.unsubscribe();
          },
          error: error => { const normalized = normalizeApiError(error); if (normalized.httpStatus === 401 || normalized.httpStatus === 403) denied(); report('failed', normalized.httpStatus === 403 ? 'Download denied.' : normalized.message); operation.unsubscribe(); }
        });
        operation.add(downloadRequest);
      },
      error: error => { const normalized = normalizeApiError(error); if (normalized.httpStatus === 401 || normalized.httpStatus === 403) denied(); report('failed', normalized.httpStatus === 403 ? 'Download denied.' : normalized.message); operation.unsubscribe(); }
    });
    operation.add(grantRequest);
    operation.add(() => this.attachmentDownloads.delete(attachmentId));
    return operation;
  }

  cancelAttachmentDownloads(): void {
    this.attachmentDownloads.forEach(request => request.unsubscribe());
    this.attachmentDownloads.clear();
  }

  private loadFiles(workspaceId: string, page: number, pageSize: number): void {
    if (this.loadingWorkspaceIds.has(workspaceId)) {
      return;
    }

    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(Math.floor(pageSize || FILES_PAGE_SIZE), 100));
    const generation = this.pageGeneration;
    this.loadingWorkspaceIds.add(workspaceId);
    const currentUpload = this.pageState().upload;
    const request = this.http
      .get<PagedResponseDto<FileListItemDto>>('/api/files', {
        params: { workspaceId, page: safePage, pageSize: safePageSize },
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          this.loadingWorkspaceIds.delete(workspaceId);
          if (generation !== this.pageGeneration || this.pageWorkspaceId !== workspaceId) {
            return;
          }

          const files = (response.items ?? []).map((item) => mapFileListItem(item)).filter((file) => file.id.length > 0);
          const responsePage = numberValue(response.page) ?? safePage;
          const responsePageSize = numberValue(response.pageSize) ?? safePageSize;
          const totalCount = numberValue(response.totalCount) ?? files.length;
          const totalPages = Math.max(1, Math.ceil(totalCount / Math.max(1, responsePageSize)));

          if (files.length === 0 && responsePage > totalPages) {
            this.loadFiles(workspaceId, totalPages, responsePageSize);
            return;
          }

          this.pageState.set({
            ...this.emptyPage(files.length === 0 ? 'No files returned by backend.' : 'Files are loaded from backend.'),
            upload: currentUpload,
            uploadQueue: this.pageState().uploadQueue,
            recentFiles: files,
            pickerFiles: files,
            page: responsePage,
            pageSize: responsePageSize,
            totalCount,
            hasMore: response.hasMore === true || responsePage * responsePageSize < totalCount,
          });
          this.inventoryRevisionSignal.update((revision) => revision + 1);
        },
        error: (error: unknown) => {
          this.loadingWorkspaceIds.delete(workspaceId);
          if (generation !== this.pageGeneration || this.pageWorkspaceId !== workspaceId) {
            return;
          }
          const normalized = normalizeApiError(error);
          this.pageState.set({
            ...this.emptyPage(normalized.message),
            upload: { ...currentUpload, canUpload: true },
            uploadQueue: this.pageState().uploadQueue,
            page: safePage,
            pageSize: safePageSize,
          });
          this.inventoryRevisionSignal.update((revision) => revision + 1);
        },
      });
    this.trackPageRequest(request);
  }

  private downloadWithGrant(fileObjectId: string, grant: FileDownloadGrantDto, generation: number, operation: Subscription): void {
    const grantId = stringValue(grant.fileDownloadGrantId);
    const token = stringValue(grant.token);
    if (!grantId || !token) {
      this.updateFileDownload(fileObjectId, {
        downloadState: 'failed',
        downloadMessage: 'Download grant response was incomplete.',
      });
      operation.unsubscribe();
      return;
    }

    const request = this.http
      .post(`/api/file-download-grants/${grantId}/download`, { token }, {
        observe: 'response',
        responseType: 'blob',
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          if (!this.isCurrentPageOperation(generation, fileObjectId)) { return; }
          const fileName = safeFileNameFromHeader(
            response.headers.get('content-disposition'),
            this.findFile(fileObjectId)?.originalFileName ?? 'download',
          );
          this.saveBlob(response, fileName);
          this.updateFileDownload(fileObjectId, {
            downloadState: 'succeeded',
            downloadMessage: 'Download started.',
          });
          operation.unsubscribe();
        },
        error: (error: unknown) => {
          if (!this.isCurrentPageOperation(generation, fileObjectId)) { return; }
          const normalized = normalizeApiError(error);
          this.updateFileDownload(fileObjectId, {
            downloadState: 'failed',
            downloadMessage: normalized.httpStatus === 403 ? 'Download denied.' : normalized.message,
          });
          operation.unsubscribe();
        },
      });
    operation.add(request);
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

  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    if (this.mockPage || event.eventType !== 'Files.FileChanged.v1') {
      return;
    }
    const workspaceId = this.activeWorkspace.activeWorkspace()?.id;
    if (!workspaceId) {
      return;
    }
    if (this.pendingUploads.size > 0) {
      this.refreshAfterMutation = true;
      return;
    }
    this.queueRefresh(workspaceId);
  }

  private reconcileAfterMutation(workspaceId: string): void {
    if (this.pendingUploads.size === 0 && this.refreshAfterMutation) {
      this.refreshAfterMutation = false;
      this.queueRefresh(workspaceId);
    }
  }

  private queueRefresh(workspaceId: string): void {
    if (this.refreshTimer !== null) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      const state = this.pageState();
      this.loadFiles(workspaceId, state.page, state.pageSize);
    }, 100);
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
      page: 1,
      pageSize: FILES_PAGE_SIZE,
      totalCount: 0,
      hasMore: false,
    };
  }

  private canUploadNow(): boolean {
    return this.pageState().upload.state !== 'pending' && this.activeWorkspace.activeWorkspace()?.id !== undefined;
  }

  private emptyPickerState(workspaceId: string | null = null): TaskFilePickerState {
    return { status: 'idle', workspaceId, files: [], page: 1, pageSize: 20, totalCount: 0, hasMore: false };
  }

  private emptyDeleteState(): FileDeleteViewModel {
    return { state: 'idle', succeededCount: 0, failedCount: 0 };
  }

  private cancelDeleteOperation(): void {
    this.deleteRequest?.unsubscribe();
    this.deleteRequest = null;
    this.deleteStateSignal.set(this.emptyDeleteState());
  }

  private trackPageRequest(request: Subscription): void {
    this.pageRequests.add(request);
    request.add(() => this.pageRequests.delete(request));
  }

  private invalidatePageRequests(): void {
    this.pageGeneration++;
    for (const request of [...this.pageRequests]) request.unsubscribe();
    this.pageRequests.clear();
    this.loadingWorkspaceIds.clear();
  }

  private isCurrentPageOperation(generation: number, fileObjectId: string): boolean {
    return generation === this.pageGeneration &&
      this.pageWorkspaceId !== null &&
      this.fileDownloads.has(fileObjectId);
  }

  private clearProtectedState(): void {
    this.cancelDeleteOperation();
    this.invalidatePageRequests();
    this.pageWorkspaceId = null;
    this.clearPickerFiles();
    for (const pending of [...this.pendingUploads.values()]) pending.subscription.unsubscribe();
    this.pendingUploads.clear();
    for (const operation of [...this.fileDownloads.values()]) operation.unsubscribe();
    this.fileDownloads.clear();
    this.cancelAttachmentDownloads();
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshAfterMutation = false;
    this.pageState.set(this.emptyPage('Select a workspace before uploading files.', false));
    this.inventoryRevisionSignal.update((revision) => revision + 1);
  }

}

function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
