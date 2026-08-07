import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { AIP_ACTIVE_WORKSPACE_MOCK } from '../../../core/workspace/active-workspace.facade';
import { AttachmentPickerDialogComponent } from '../attachment-picker-dialog/attachment-picker-dialog.component';
import { FileRowComponent } from '../file-row/file-row.component';
import { AIP_FILES_PAGE_MOCK } from '../files.facade';
import { DEFAULT_FILES, FILES_PAGE_SCENARIOS } from '../files.mock';
import { FilesPageViewModel } from '../files.types';
import { AipFileUploaderComponent } from '../../../shared/ui/adapters/syncfusion/aip-file-uploader.component';
import { FilesPageComponent } from './files-page.component';

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';

const backendFile = {
  id: 'attachment-1',
  fileObjectId: 'file-object-1',
  workspaceId: WORKSPACE_ID,
  originalFileName: 'note.txt',
  contentType: 'text/plain',
  sizeBytes: 12,
  status: 'Active',
  scanStatus: 'Skipped',
  uploadedByUserId: 'user-1',
  uploadedByDisplayName: 'Fixture User',
  createdAt: '2026-07-08T00:00:00Z',
};

const renderMockFilesPage = async (page: FilesPageViewModel): Promise<ComponentFixture<FilesPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [FilesPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AIP_FILES_PAGE_MOCK, useValue: page },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FilesPageComponent);
  fixture.detectChanges();
  return fixture;
};

const renderLiveFilesPage = async (
  items: readonly unknown[] = [],
): Promise<{ fixture: ComponentFixture<FilesPageComponent>; http: HttpTestingController }> => {
  await TestBed.configureTestingModule({
    imports: [FilesPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AIP_ACTIVE_WORKSPACE_MOCK, useValue: { id: WORKSPACE_ID, label: 'Workspace' } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FilesPageComponent);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  await fixture.whenStable();
  flushFileList(http, items);
  fixture.detectChanges();
  return { fixture, http };
};

const flushFileList = (http: HttpTestingController, items: readonly unknown[]): void => {
  const request = http.expectOne((candidate) => candidate.url === '/api/files' && candidate.method === 'GET');
  expect(request.request.params.get('workspaceId')).toBe(WORKSPACE_ID);
  expect(request.request.params.get('page')).toBe('1');
  expect(request.request.params.get('pageSize')).toBe('20');
  expect(request.request.withCredentials).toBe(true);
  request.flush({ items });
};

const textContent = (fixture: ComponentFixture<FilesPageComponent>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

const downloadButton = (fixture: ComponentFixture<FilesPageComponent>): HTMLButtonElement =>
  (fixture.nativeElement as HTMLElement).querySelector('[data-testid="download-action"]') as HTMLButtonElement;

describe('FilesPageComponent', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('uploads a valid file only through the backend and reloads recent files after success', async () => {
    const { fixture, http } = await renderLiveFilesPage([]);
    const dropZone = fixture.debugElement.query(By.directive(AipFileUploaderComponent))
      .componentInstance as AipFileUploaderComponent;

    dropZone.filesSelected.emit([new File(['hello'], 'note.txt', { type: 'text/plain' })]);
    fixture.detectChanges();

    const upload = http.expectOne((request) => request.url === '/api/files' && request.method === 'POST');
    expect(upload.request.withCredentials).toBe(true);
    const body = upload.request.body as FormData;
    expect(body.get('OwnerType')).toBe('Workspace');
    expect(body.get('OwnerId')).toBe(WORKSPACE_ID);
    expect((body.get('File') as File).name).toBe('note.txt');
    expect(textContent(fixture)).toContain('Uploading file to backend.');

    upload.flush({ id: 'attachment-1', fileObjectId: 'file-object-1', originalFileName: 'note.txt' });
    flushFileList(http, [backendFile]);
    fixture.detectChanges();

    expect(textContent(fixture)).toContain('Upload accepted by backend.');
    expect(textContent(fixture)).toContain('note.txt');
  }, 15_000);

  it('keeps retry state when backend upload fails', async () => {
    const { fixture, http } = await renderLiveFilesPage([]);
    const dropZone = fixture.debugElement.query(By.directive(AipFileUploaderComponent))
      .componentInstance as AipFileUploaderComponent;

    dropZone.filesSelected.emit([new File(['hello'], 'note.txt', { type: 'text/plain' })]);
    fixture.detectChanges();

    const upload = http.expectOne((request) => request.url === '/api/files' && request.method === 'POST');
    upload.flush({ error: 'File extension is not allowed.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(textContent(fixture)).toContain('File extension is not allowed.');
    expect(textContent(fixture)).toContain('note.txt');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="file-upload-disabled"]')).toBeNull();
    http.expectNone((request) => request.url === '/api/files' && request.method === 'GET');
  });

  it('submits oversize files to the backend policy rather than inventing a client limit', async () => {
    const { fixture, http } = await renderLiveFilesPage([]);
    const dropZone = fixture.debugElement.query(By.directive(AipFileUploaderComponent))
      .componentInstance as AipFileUploaderComponent;

    dropZone.filesSelected.emit([{ name: 'oversized-video.mp4', size: 51 * 1024 * 1024, type: 'video/mp4' } as File]);
    fixture.detectChanges();

    const upload = http.expectOne((request) => request.url === '/api/files' && request.method === 'POST');
    upload.flush({ error: 'File exceeds the configured upload limit.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(textContent(fixture)).toContain('File exceeds the configured upload limit.');
  });

  it('submits file types to the backend policy rather than duplicating its allowlist', async () => {
    const { fixture, http } = await renderLiveFilesPage([]);
    const dropZone = fixture.debugElement.query(By.directive(AipFileUploaderComponent))
      .componentInstance as AipFileUploaderComponent;

    dropZone.filesSelected.emit([new File(['bad'], 'run.exe', { type: 'application/x-msdownload' })]);
    fixture.detectChanges();

    const upload = http.expectOne((request) => request.url === '/api/files' && request.method === 'POST');
    upload.flush({ error: 'File extension is not allowed.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(textContent(fixture)).toContain('File extension is not allowed.');
  });

  it('downloads through backend grant issuance and grant download', async () => {
    const { fixture, http } = await renderLiveFilesPage([backendFile]);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    downloadButton(fixture).click();
    fixture.detectChanges();

    const grant = http.expectOne('/api/files/file-object-1/download-grants');
    expect(grant.request.method).toBe('POST');
    expect(grant.request.body).toEqual({ purpose: 'files-page-download' });
    expect(grant.request.withCredentials).toBe(true);
    grant.flush({ fileDownloadGrantId: 'grant-1', fileObjectId: 'file-object-1', token: 'raw-token' });

    const download = http.expectOne('/api/file-download-grants/grant-1/download');
    expect(download.request.method).toBe('POST');
    expect(download.request.body).toEqual({ token: 'raw-token' });
    expect(download.request.withCredentials).toBe(true);
    download.flush(new Blob(['hello'], { type: 'text/plain' }), {
      headers: { 'content-disposition': 'attachment; filename="note.txt"' },
    });
    fixture.detectChanges();

    expect(clickSpy).toHaveBeenCalled();
    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:fixture');
    expect(textContent(fixture)).toContain('Download started.');
  });

  it('shows a safe denied state when download grant issuance is denied', async () => {
    const { fixture, http } = await renderLiveFilesPage([backendFile]);

    downloadButton(fixture).click();
    fixture.detectChanges();

    const grant = http.expectOne('/api/files/file-object-1/download-grants');
    grant.flush({ error: 'not allowed' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(textContent(fixture)).toContain('Download denied.');
    http.expectNone((request) => request.url.startsWith('/api/file-download-grants/'));
  });

  it('disables download while scan is pending or blocked', async () => {
    const pending = await renderMockFilesPage(FILES_PAGE_SCENARIOS.scanPending);
    expect(downloadButton(pending).disabled).toBe(true);
    expect(textContent(pending)).toContain('Download is disabled until scan state allows it.');

    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();

    const blocked = await renderMockFilesPage(FILES_PAGE_SCENARIOS.scanBlocked);
    expect(downloadButton(blocked).disabled).toBe(true);
    expect(textContent(blocked)).toContain('Download is blocked by file scan state.');
  });

  it('does not render preview, SVG image, public link, or streaming elements', async () => {
    const fixture = await renderMockFilesPage(FILES_PAGE_SCENARIOS.previewDisabled);
    const host = fixture.nativeElement as HTMLElement;
    const text = textContent(fixture);

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('object')).toBeNull();
    expect(host.querySelector('embed')).toBeNull();
    expect(host.querySelector('video')).toBeNull();
    expect(host.querySelector('svg')).toBeNull();
    expect(text).toContain('Preview is not available in MVP0.');
    expect(text).toContain('CDN links, public links, and external signed URL sharing are disabled.');
  });

  it('does not expose internal storage keys, paths, or raw scan metadata', async () => {
    const fixture = await renderMockFilesPage(FILES_PAGE_SCENARIOS.default);
    const text = textContent(fixture);

    expect(text).not.toContain('tenant-a/private/raw');
    expect(text).not.toContain('/var/lib/aipsite/private/raw');
    expect(text).not.toContain('engine=mock');
    expect(text).not.toContain('private-debug-value');
  });

  it('keeps attachment picker disabled in MVP0', async () => {
    const fixture = await renderMockFilesPage(FILES_PAGE_SCENARIOS.noCanonicalFileIdYet);
    const checkboxes = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      '[data-testid="attachment-picker-checkbox"]',
    );
    const picker = fixture.debugElement.query(By.directive(AttachmentPickerDialogComponent))
      .componentInstance as AttachmentPickerDialogComponent;

    expect(Array.from(checkboxes).every((checkbox) => checkbox.disabled)).toBe(true);

    picker.toggleFile(DEFAULT_FILES[0], true);
    fixture.detectChanges();

    expect(textContent(fixture)).toContain('Attachment picker is not available in MVP0.');
    expect(textContent(fixture)).toContain('No file selected.');
  });

  it('keeps admin override disabled even when a reason is entered', async () => {
    const fixture = await renderMockFilesPage(FILES_PAGE_SCENARIOS.adminOverrideRequired);
    const row = fixture.debugElement.query(By.directive(FileRowComponent)).componentInstance as FileRowComponent;
    const action = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="admin-override-action"]',
    ) as HTMLButtonElement;

    row.updateAuditReason('Operational need');
    fixture.detectChanges();

    expect(action.disabled).toBe(true);
    expect(textContent(fixture)).toContain('Admin override is not wired for MVP0 downloads.');
  });
});
