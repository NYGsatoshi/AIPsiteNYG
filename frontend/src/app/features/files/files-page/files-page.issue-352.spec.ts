import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AIP_AUTH_SESSION_MOCK, DEFAULT_AUTH_SESSION } from '../../../core/auth/auth-session.facade';
import { AIP_ACTIVE_WORKSPACE_MOCK } from '../../../core/workspace/active-workspace.facade';
import { AIP_FILES_PAGE_MOCK } from '../files.facade';
import { FILES_PAGE_SCENARIOS } from '../files.mock';
import { FilesPageViewModel, FileViewModel } from '../files.types';
import { FilesPageComponent } from './files-page.component';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const IMAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PDF_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VIDEO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEXT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const backendFile = (fileObjectId: string, originalFileName: string, contentType: string) => ({
  id: `attachment-${fileObjectId.slice(0, 4)}`,
  fileObjectId,
  workspaceId: WORKSPACE_ID,
  originalFileName,
  contentType,
  sizeBytes: 128,
  status: 'Active',
  scanStatus: 'Skipped',
  uploadedByUserId: 'user-1',
  uploadedByDisplayName: 'Fixture User',
  createdAt: '2026-08-29T00:00:00Z',
  updatedAt: '2026-08-29T00:00:00Z',
  canDelete: true,
});

const renderLiveFilesPage = async (
  items: readonly unknown[],
): Promise<{ fixture: ComponentFixture<FilesPageComponent>; http: HttpTestingController }> => {
  await TestBed.configureTestingModule({
    imports: [FilesPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AIP_AUTH_SESSION_MOCK, useValue: DEFAULT_AUTH_SESSION },
      { provide: AIP_ACTIVE_WORKSPACE_MOCK, useValue: { id: WORKSPACE_ID, label: 'Workspace' } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FilesPageComponent);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  const list = http.expectOne((request) => request.url === '/api/files' && request.method === 'GET');
  list.flush({ items, page: 1, pageSize: 50, totalCount: items.length, hasMore: false });
  fixture.detectChanges();
  return { fixture, http };
};

const renderMockFilesPage = async (
  page: FilesPageViewModel,
): Promise<{ fixture: ComponentFixture<FilesPageComponent>; http: HttpTestingController }> => {
  await TestBed.configureTestingModule({
    imports: [FilesPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AIP_FILES_PAGE_MOCK, useValue: page },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FilesPageComponent);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return { fixture, http };
};

const flushPreview = (
  http: HttpTestingController,
  fileObjectId: string,
  grantId: string,
  blob: Blob,
): void => {
  const grant = http.expectOne(`/api/files/${fileObjectId}/download-grants`);
  expect(grant.request.method).toBe('POST');
  expect(grant.request.body).toEqual({ purpose: 'files-page-preview' });
  expect(grant.request.withCredentials).toBe(true);
  grant.flush({ fileDownloadGrantId: grantId, fileObjectId, token: `token-${grantId}` });

  const download = http.expectOne(`/api/file-download-grants/${grantId}/download`);
  expect(download.request.method).toBe('POST');
  expect(download.request.body).toEqual({ token: `token-${grantId}` });
  expect(download.request.withCredentials).toBe(true);
  download.flush(blob, { headers: { 'content-type': blob.type } });
};

const installBlobTextPolyfill = (): (() => void) => {
  const prototype = Blob.prototype as unknown as { text?: () => Promise<string> };
  const existing = Object.getOwnPropertyDescriptor(Blob.prototype, 'text');
  if (typeof prototype.text === 'function') {
    return () => undefined;
  }

  Object.defineProperty(Blob.prototype, 'text', {
    configurable: true,
    writable: true,
    value(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error ?? new Error('Blob text read failed.'));
        reader.readAsText(this);
      });
    },
  });

  return () => {
    if (existing) {
      Object.defineProperty(Blob.prototype, 'text', existing);
    } else {
      Reflect.deleteProperty(Blob.prototype, 'text');
    }
  };
};

const installClipboardMock = (): { writeText: ReturnType<typeof vi.fn>; restore: () => void } => {
  const existing = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return {
    writeText,
    restore: () => {
      if (existing) {
        Object.defineProperty(navigator, 'clipboard', existing);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    },
  };
};

describe('FilesPageComponent issue #352', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('opens an authorized image in the right inspector without changing selection or list scroll', async () => {
    const clipboard = installClipboardMock();
    try {
      const { fixture, http } = await renderLiveFilesPage([
        backendFile(IMAGE_ID, 'photo.png', 'image/png'),
      ]);
      const component = fixture.componentInstance;
      const file = component.page().recentFiles[0];
      if (!file) {
        throw new Error('Expected a listed file.');
      }

      const listSurface = (fixture.nativeElement as HTMLElement).querySelector('.files-page__desktop-grid') as HTMLElement;
      listSurface.scrollTop = 173;
      component.handleSelectionChanged({ rows: [file] });
      const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:authorized-image');
      const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      component.handleGridAction({ actionId: 'open', row: file });
      fixture.detectChanges();

      expect(component.selectedCount()).toBe(1);
      expect(listSurface.scrollTop).toBe(173);
      flushPreview(http, IMAGE_ID, 'grant-image', new Blob(['image'], { type: 'image/png' }));
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="files-preview-image"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="files-preview-pdf"]')).toBeNull();
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(component.selectedCount()).toBe(1);
      expect(listSurface.scrollTop).toBe(173);

      const open = host.querySelector('[data-testid="files-preview-open"]') as HTMLAnchorElement;
      const research = host.querySelector('[data-testid="files-preview-research"]') as HTMLAnchorElement;
      expect(open.getAttribute('href')).toBe('blob:authorized-image');
      expect(research.getAttribute('href')).toContain(`/workspaces/${WORKSPACE_ID}/research/new?`);
      expect(research.getAttribute('href')).toContain(`sourceFileObjectId=${IMAGE_ID}`);
      expect(research.getAttribute('href')).toContain('sourceFileName=photo.png');
      expect(host.querySelector('[data-testid="files-preview-share"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="files-preview-more"]')).not.toBeNull();

      component.copyPreviewCitation();
      await Promise.resolve();
      fixture.detectChanges();
      expect(clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(String(clipboard.writeText.mock.calls[0]?.[0])).toContain('photo.png');
      expect(String(clipboard.writeText.mock.calls[0]?.[0])).toContain(IMAGE_ID);
      expect(component.previewActionStatus()).toBe('Citation copied.');

      component.closePreview();
      fixture.detectChanges();
      expect(component.selectedCount()).toBe(1);
      expect(listSurface.scrollTop).toBe(173);
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:authorized-image');
    } finally {
      clipboard.restore();
    }
  }, 15_000);

  it('renders PDF, video, and text-like files from authorized blobs without public URLs', async () => {
    const restoreBlobText = installBlobTextPolyfill();
    try {
      const { fixture, http } = await renderLiveFilesPage([
        backendFile(PDF_ID, 'brief.pdf', 'application/pdf'),
        backendFile(VIDEO_ID, 'lesson.mp4', 'video/mp4'),
        backendFile(TEXT_ID, 'notes.txt', 'text/plain'),
      ]);
      const component = fixture.componentInstance;
      const [pdf, video, text] = component.page().recentFiles;
      if (!pdf || !video || !text) {
        throw new Error('Expected PDF, video, and text fixtures.');
      }

      vi.spyOn(URL, 'createObjectURL')
        .mockReturnValueOnce('blob:authorized-pdf')
        .mockReturnValueOnce('blob:authorized-video')
        .mockReturnValueOnce('blob:authorized-text');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      component.openPreview(pdf);
      flushPreview(http, PDF_ID, 'grant-pdf', new Blob(['pdf'], { type: 'application/pdf' }));
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="files-preview-pdf"]')).not.toBeNull();

      component.openPreview(video);
      flushPreview(http, VIDEO_ID, 'grant-video', new Blob(['video'], { type: 'video/mp4' }));
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="files-preview-video"]')).not.toBeNull();

      component.openPreview(text);
      flushPreview(http, TEXT_ID, 'grant-text', new Blob(['hello from preview'], { type: 'text/plain' }));
      await fixture.whenStable();
      await Promise.resolve();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="files-preview-text"]')?.textContent)
        .toContain('hello from preview');
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="files-preview-open"]')?.getAttribute('href'))
        .toBe('blob:authorized-text');

      const policy = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="file-policy"]')?.textContent ?? '';
      expect(policy).toContain('CDN links, public links, and external signed URL sharing are disabled. Preview never uses those links.');
    } finally {
      restoreBlobText();
    }
  }, 15_000);

  it('fails closed without requesting preview content when scan or access state is not authorized', async () => {
    const { fixture, http } = await renderLiveFilesPage([
      { ...backendFile(IMAGE_ID, 'blocked.png', 'image/png'), scanStatus: 'Infected' },
    ]);
    const component = fixture.componentInstance;
    const file = component.page().recentFiles[0];
    if (!file) {
      throw new Error('Expected a listed file.');
    }

    component.openPreview(file);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="files-preview-error"]')?.textContent)
      .toContain('blocked by file scan state');
    http.expectNone(`/api/files/${IMAGE_ID}/download-grants`);
  });

  it('uses a focus-trapped overlay at 320px and returns focus without clearing selection', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });

    try {
      const seed = FILES_PAGE_SCENARIOS.default.recentFiles[0];
      if (!seed) {
        throw new Error('Expected a file fixture.');
      }
      const unsupported: FileViewModel = {
        ...seed,
        id: 'zip-preview-fixture',
        canonicalFileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        originalFileName: 'archive.zip',
        contentType: 'application/zip',
        kind: 'zip',
        scanStatus: 'allowed',
        downloadPolicy: 'available',
        capabilities: ['download'],
      };
      const { fixture, http } = await renderMockFilesPage({
        ...FILES_PAGE_SCENARIOS.default,
        recentFiles: [unsupported],
        pickerFiles: [unsupported],
        totalCount: 1,
      });
      const host = fixture.nativeElement as HTMLElement;
      const trigger = host.querySelector('[data-testid="preview-action"]') as HTMLButtonElement;
      const selection = host.querySelector('[data-testid="mobile-file-selection"]') as HTMLInputElement;

      selection.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedCount()).toBe(1);

      trigger.focus();
      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const pane = host.querySelector('[data-testid="files-preview-pane"]') as HTMLElement;
      const close = host.querySelector('[data-testid="files-preview-close"]') as HTMLButtonElement;
      expect(fixture.componentInstance.previewOverlay()).toBe(true);
      expect(pane.getAttribute('role')).toBe('dialog');
      expect(pane.getAttribute('aria-modal')).toBe('true');
      expect(host.querySelector('[data-testid="files-preview-backdrop"]')).not.toBeNull();
      expect(document.activeElement).toBe(close);
      expect(fixture.componentInstance.selectedCount()).toBe(1);
      http.expectNone(`/api/files/${unsupported.canonicalFileId}/download-grants`);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      await Promise.resolve();

      expect(fixture.componentInstance.previewOpen()).toBe(false);
      expect(fixture.componentInstance.selectedCount()).toBe(1);
      expect(document.activeElement).toBe(trigger);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  }, 15_000);
});
