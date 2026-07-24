import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { FilesFacade } from './files.facade';

describe('FilesFacade task picker query state', () => {
  let facade: FilesFacade;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: ActiveWorkspaceFacade, useValue: { activeWorkspace: signal(null) } },
      { provide: RealtimeFacade, useValue: { durableEvents$: new Subject() } }
    ] });
    facade = TestBed.inject(FilesFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('keeps existing candidates and retries the failed second page', () => {
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

  function file(id: string) { return { id, originalFileName: `${id}.txt`, contentType: 'text/plain', sizeBytes: 1, scanStatus: 'Allowed', uploadedByDisplay: 'Tester', createdAt: '2026-07-24T00:00:00Z' }; }
});
