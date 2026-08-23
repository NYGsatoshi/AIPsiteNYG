import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { FilesFacade } from './files.facade';

describe('FilesFacade paging query state', () => {
  let facade: FilesFacade;
  let http: HttpTestingController;
  let clearProtectedState: (() => void) | undefined;

  beforeEach(() => {
    clearProtectedState = undefined;
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: ActiveWorkspaceFacade, useValue: { activeWorkspace: signal(null) } },
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

  function file(id: string) {
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
    };
  }
});
