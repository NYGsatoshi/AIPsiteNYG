import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { FILES_PAGE_SCENARIOS } from '../files.mock';
import { FileActivityPanelComponent } from './file-activity-panel.component';

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  VERSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  FILE_SIZE_BYTES = 128,
  VERSION_NUMBER = 2,
  file = {
    ...FILES_PAGE_SCENARIOS.default.recentFiles[0]!,
    canonicalFileId: FILE_ID,
    capabilities: ['download'],
    contentType: 'text/plain',
    downloadPolicy: 'available',
    id: 'activity-file',
    kind: 'document',
    originalFileName: 'research-notes.txt',
    scanStatus: 'allowed',
    sizeBytes: FILE_SIZE_BYTES,
  },
  setupVersion = async (options: Readonly<{ contentType: string; fileName: string }>) => {
    await TestBed.configureTestingModule({
      imports: [FileActivityPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(FileActivityPanelComponent),
      http = TestBed.inject(HttpTestingController),
      host = fixture.nativeElement instanceof HTMLElement ? fixture.nativeElement : null,
      createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:historical-pdf');
    fixture.componentRef.setInput('file', file);
    fixture.detectChanges();
    http.expectOne(`/api/files/${FILE_ID}/activity`).flush({
      fileObjectId: FILE_ID,
      items: [{
        actorDisplayName: 'File Editor',
        id: VERSION_ID,
        kind: 'versionCreated',
        occurredAt: '2026-09-01T13:00:00Z',
        version: {
          contentType: options.contentType,
          createdAt: '2026-09-01T13:00:00Z',
          fileName: options.fileName,
          isCurrent: true,
          sizeBytes: FILE_SIZE_BYTES,
          versionId: VERSION_ID,
          versionNumber: VERSION_NUMBER,
        },
      }],
    });
    fixture.detectChanges();
    host?.querySelector<HTMLButtonElement>('[data-testid="files-activity-view-version"]')?.click();
    fixture.detectChanges();
    return { createObjectUrl, fixture, host, http };
  };

beforeEach(() => {
  window.localStorage.setItem('aip.locale', 'en');
});

afterEach(() => {
  window.localStorage.removeItem('aip.locale');
  TestBed.inject(HttpTestingController).verify();
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

it('opens a historical PDF only after the returned Blob MIME matches the PDF metadata', async () => {
  const { createObjectUrl, fixture, host, http } = await setupVersion({ contentType: 'application/pdf', fileName: 'brief.pdf' }),
    request = http.expectOne(`/api/files/${FILE_ID}/versions/${VERSION_ID}/content`);
  request.flush(new Blob(['pdf'], { type: 'application/pdf' }));
  fixture.detectChanges();
  expect(host?.querySelector('[data-testid="files-version-preview-pdf-link"]')).not.toBeNull();
  expect(host?.querySelector('[data-testid="files-version-preview-pdf-link"]')?.getAttribute('href')).toBe('blob:historical-pdf');
  expect(host?.querySelector('[data-testid="files-version-preview-pdf-link"]')?.getAttribute('target')).toBe('_blank');
  expect(host?.querySelector('[data-testid="files-version-preview-pdf-link"]')?.getAttribute('rel')).toContain('noopener');
  expect(host?.querySelector('iframe')).toBeNull();
  expect(createObjectUrl).toHaveBeenCalledOnce();
});

it('fails closed when historical PDF metadata does not match the returned Blob MIME', async () => {
  const { createObjectUrl, fixture, host, http } = await setupVersion({ contentType: 'application/pdf', fileName: 'brief.pdf' }),
    request = http.expectOne(`/api/files/${FILE_ID}/versions/${VERSION_ID}/content`);
  request.flush(new Blob(['<html>active</html>'], { type: 'text/html' }));
  fixture.detectChanges();
  expect(host?.querySelector('[data-testid="files-version-preview-pdf-link"]')).toBeNull();
  expect(host?.textContent).toContain('The returned file type did not match this version.');
  expect(createObjectUrl).not.toHaveBeenCalled();
});

it('does not fetch or mint a Blob URL for an unsupported historical active-content type', async () => {
  const { createObjectUrl, host, http } = await setupVersion({ contentType: 'application/xhtml+xml', fileName: 'payload.xhtml' });
  http.expectNone(`/api/files/${FILE_ID}/versions/${VERSION_ID}/content`);
  expect(host?.textContent).toContain('Preview is not available for this file type.');
  expect(host?.querySelector('a[href^="blob:"]')).toBeNull();
  expect(createObjectUrl).not.toHaveBeenCalled();
});