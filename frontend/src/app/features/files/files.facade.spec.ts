import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { ContinueWorkingHistoryService } from '../../shared/continue-working/continue-working-history.service';
import { FilesFacade } from './files.facade';

describe('FilesFacade paging query state', () => {
  let facade: FilesFacade;
  let http: HttpTestingController;
  let clearProtectedState: (() => void) | undefined;
  let activeWorkspaceState: ReturnType<typeof signal<{ readonly id: string; readonly label: string } | null>>;
  const continueWorkingHistory = { touchFile: vi.fn() };

  beforeEach(() => {
    clearProtectedState = undefined;
    activeWorkspaceState = signal<{ readonly id: string; readonly label: string } | null>(null);
    continueWorkingHistory.touchFile.mockReset();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: ActiveWorkspaceFacade, useValue: { activeWorkspace: activeWorkspaceState } },
      { provide: ContinueWorkingHistoryService, useValue: continueWorkingHistory },
      {
        provide: RealtimeFacade,
        useValue: {
          durableEvents$: new Subject(),
          registerProtectedStateClearer: (_owner: string, clear: () => void) => {
            clearProtectedState = clear;
            return () => { clearProtectedState = undefined; };
          },
        },
      }
    ] });
    facade = TestBed.inject(FilesFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('keeps existing picker candidates and retries the failed second page', () => {
    facade.loadPickerFilesForWorkspace('workspace-a');
    http.expectOne(request => request.url === '/api/files' && request.params.get('page') === '1').flush({ items: [file('file-1')], page: 1, pageSize: 20, totalCount: 2, hasMore: true });
    facade.loadMorePickerFiles();
    http.expectOne(request => request.url === '/api/files' && request.params.get('page') === '2').flush({ message: 'offline', traceId: 'picker-2' }, { status: 500, statusText: 'Server Error' });
    expect(facade.pickerStateForTask()).toMatchObject({ status: 'error', failedPage: 2, files: [expect.objectContaining({ id: 'file-1' })] });

    facade.retryPickerFiles();
    http.expectOne(request => request.url === '/api/files' && request.params.get('page') === '2').flush({ items: [file('file-1'), file('file-2')], page: 2, pageSize: 20, totalCount: 2, hasMore: false });
    expect(facade.pickerStateForTask().files.map(item => item.id)).toEqual(['file-1', 'file-2']);
  });

  it('keeps the active workspace page separate and reports picker authorization denial', () => {
    facade.loadPickerFilesForWorkspace('workspace-a');
    http.expectOne('/api/files?workspaceId=workspace-a&page=1&pageSize=20').flush({ message: 'denied', traceId: 'picker-403' }, { status: 403, statusText: 'Forbidden' });
    expect(facade.pickerStateForTask()).toMatchObject({ status: 'permissionDenied', workspaceId: 'workspace-a', requestId: 'picker-403' });
  });

  it('reaches the final server page when the workspace contains more than 1,000 files', () => {
    facade.loadPageFilesForWorkspace('workspace-a');
    const first = http.expectOne(request =>
      request.url === '/api/files' &&
      request.params.get('workspaceId') === 'workspace-a' &&
      request.params.get('page') === '1' &&
      request.params.get('pageSize') === '50'
    );
    first.flush({
      items: Array.from({ length: 50 }, (_, index) => file(`file-${index + 1}`)),
      page: 1,
      pageSize: 50,
      totalCount: 1_001,
      hasMore: true,
    });

    expect(facade.page()).toMatchObject({ page: 1, pageSize: 50, totalCount: 1_001, hasMore: true });
    expect(facade.page().recentFiles).toHaveLength(50);

    facade.goToPage(21);
    const last = http.expectOne(request =>
      request.url === '/api/files' &&
      request.params.get('workspaceId') === 'workspace-a' &&
      request.params.get('page') === '21' &&
      request.params.get('pageSize') === '50'
    );
    last.flush({ items: [file('file-1001')], page: 21, pageSize: 50, totalCount: 1_001, hasMore: false });

    expect(facade.page()).toMatchObject({ page: 21, pageSize: 50, totalCount: 1_001, hasMore: false });
    expect(facade.page().recentFiles.map(item => item.id)).toEqual(['file-1001']);
  });

  it('synchronously clears Workspace projections and cancels late page and picker responses', () => {
    facade.loadPageFilesForWorkspace('workspace-a');
    facade.loadPickerFilesForWorkspace('workspace-a');
    const pending = http.match((request) => request.url === '/api/files');
    expect(pending).toHaveLength(2);

    clearProtectedState?.();

    expect(pending.every((request) => request.cancelled)).toBe(true);
    expect(facade.page()).toMatchObject({
      recentFiles: [],
      pickerFiles: [],
      totalCount: 0,
      hasMore: false,
      upload: { state: 'idle', canUpload: false },
    });
    expect(facade.pickerStateForTask()).toMatchObject({
      status: 'idle',
      workspaceId: null,
      files: [],
      totalCount: 0,
    });
  });

  it('deletes selected files serially and reports a non-atomic partial outcome', () => {
    facade.loadPageFilesForWorkspace('workspace-a');
    http.expectOne(request => request.url === '/api/files' && request.method === 'GET').flush({
      items: [file('file-1', true), file('file-2', true)],
      page: 1,
      pageSize: 50,
      totalCount: 2,
      hasMore: false,
    });

    facade.deleteFiles(facade.page().recentFiles);

    const first = http.expectOne('/api/files/object-file-1');
    expect(first.request.method).toBe('DELETE');
    expect(first.request.withCredentials).toBe(true);
    http.expectNone('/api/files/object-file-2');
    first.flush(null);

    const second = http.expectOne('/api/files/object-file-2');
    expect(second.request.method).toBe('DELETE');
    second.flush({ message: 'denied' }, { status: 403, statusText: 'Forbidden' });

    expect(facade.deleteState()).toMatchObject({ state: 'partial', succeededCount: 1, failedCount: 1 });
    expect(facade.deleteState().message).toContain('not an atomic batch');
    expect(facade.page().recentFiles.map((item) => item.id)).toEqual(['file-2']);

    http.expectOne(request => request.url === '/api/files' && request.method === 'GET').flush({
      items: [file('file-2', true)],
      page: 1,
      pageSize: 50,
      totalCount: 1,
      hasMore: false,
    });
  });

  it('does not issue a delete when the projected capability is false', () => {
    facade.loadPageFilesForWorkspace('workspace-a');
    http.expectOne(request => request.url === '/api/files' && request.method === 'GET').flush({
      items: [file('file-1', false)],
      page: 1,
      pageSize: 50,
      totalCount: 1,
      hasMore: false,
    });

    facade.deleteFiles(facade.page().recentFiles);

    expect(facade.deleteState()).toMatchObject({ state: 'failed', succeededCount: 0, failedCount: 1 });
    http.expectNone(request => request.method === 'DELETE');
  });

  it('rejects a Task attachment grant whose FileObject does not match the authorized Task projection', () => {
    activeWorkspaceState.set({ id: 'workspace-a', label: 'Workspace A' });
    facade.downloadAttachment('attachment-a', 'evidence.pdf', {
      workspaceId: 'workspace-a',
      fileObjectId: 'file-a',
    });

    http.expectOne('/api/attachments/attachment-a/download-grants').flush({
      fileDownloadGrantId: 'grant-a',
      fileObjectId: 'file-b',
      token: 'raw-token',
    });

    http.expectNone(request => request.url.includes('/api/attachment-download-grants/'));
    expect(continueWorkingHistory.touchFile).not.toHaveBeenCalled();
  });

  it('does not touch another Workspace bucket when the active Workspace changes before an attachment Blob completes', () => {
    activeWorkspaceState.set({ id: 'workspace-a', label: 'Workspace A' });
    const onState = vi.fn();
    const onPermissionDenied = vi.fn();
    facade.downloadAttachment('attachment-a', 'evidence.pdf', {
      workspaceId: 'workspace-a',
      fileObjectId: 'file-a',
      isCurrent: () => true,
      onState,
      onPermissionDenied,
    });
    http.expectOne('/api/attachments/attachment-a/download-grants').flush({
      fileDownloadGrantId: 'grant-a',
      fileObjectId: 'file-a',
      token: 'raw-token',
    });
    const download = http.expectOne('/api/attachment-download-grants/grant-a/download');
    onState.mockClear();

    activeWorkspaceState.set({ id: 'workspace-b', label: 'Workspace B' });
    download.flush(
      new Blob([JSON.stringify({ message: 'denied' })], { type: 'application/json' }),
      { status: 403, statusText: 'Forbidden' },
    );

    expect(continueWorkingHistory.touchFile).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
    expect(onPermissionDenied).not.toHaveBeenCalled();
  });

  it('ignores a late attachment grant denial after the active Workspace changes', () => {
    activeWorkspaceState.set({ id: 'workspace-a', label: 'Workspace A' });
    const onState = vi.fn();
    const onPermissionDenied = vi.fn();
    facade.downloadAttachment('attachment-a', 'evidence.pdf', {
      workspaceId: 'workspace-a',
      fileObjectId: 'file-a',
      isCurrent: () => true,
      onState,
      onPermissionDenied,
    });
    const grant = http.expectOne('/api/attachments/attachment-a/download-grants');
    onState.mockClear();

    activeWorkspaceState.set({ id: 'workspace-b', label: 'Workspace B' });
    grant.flush({ message: 'denied' }, { status: 403, statusText: 'Forbidden' });

    expect(onState).not.toHaveBeenCalled();
    expect(onPermissionDenied).not.toHaveBeenCalled();
    expect(continueWorkingHistory.touchFile).not.toHaveBeenCalled();
  });

  it('touches the exact captured Task Workspace only after an attachment Blob download succeeds', () => {
    activeWorkspaceState.set({ id: 'workspace-a', label: 'Workspace A' });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:attachment');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    facade.downloadAttachment('attachment-a', 'evidence.pdf', {
      workspaceId: 'workspace-a',
      fileObjectId: 'file-a',
      isCurrent: () => true,
    });
    http.expectOne('/api/attachments/attachment-a/download-grants').flush({
      fileDownloadGrantId: 'grant-a',
      fileObjectId: 'file-a',
      token: 'raw-token',
    });

    expect(continueWorkingHistory.touchFile).not.toHaveBeenCalled();
    http.expectOne('/api/attachment-download-grants/grant-a/download').flush(
      new Blob(['evidence'], { type: 'application/pdf' }),
      { headers: { 'content-disposition': 'attachment; filename="evidence.pdf"' } },
    );

    expect(click).toHaveBeenCalled();
    expect(continueWorkingHistory.touchFile).toHaveBeenCalledWith('file-a', 'workspace-a');
  });

  function file(id: string, canDelete = false) {
    return {
      id,
      fileObjectId: `object-${id}`,
      originalFileName: `${id}.txt`,
      contentType: 'text/plain',
      sizeBytes: 1,
      status: 'Active',
      scanStatus: 'Allowed',
      uploadedByDisplayName: 'Tester',
      createdAt: '2026-07-24T00:00:00Z',
      updatedAt: '2026-07-25T00:00:00Z',
      canDelete,
    };
  }
});
