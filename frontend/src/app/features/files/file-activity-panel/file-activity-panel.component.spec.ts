import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FILES_PAGE_SCENARIOS } from '../files.mock';
import { FileViewModel } from '../files.types';
import { FileActivityPanelComponent } from './file-activity-panel.component';

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const file: FileViewModel = {
  ...FILES_PAGE_SCENARIOS.default.recentFiles[0]!,
  id: 'activity-file',
  canonicalFileId: FILE_ID,
  originalFileName: 'research-notes.txt',
  contentType: 'text/plain',
  sizeBytes: 128,
  kind: 'document',
  scanStatus: 'allowed',
  downloadPolicy: 'available',
  capabilities: ['download'],
};

async function render(): Promise<ComponentFixture<FileActivityPanelComponent>> {
  await TestBed.configureTestingModule({
    imports: [FileActivityPanelComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(FileActivityPanelComponent);
  fixture.componentRef.setInput('file', file);
  fixture.detectChanges();
  return fixture;
}

function browserTextBlob(text: string, type: string): Blob {
  const blob = new Blob([text], { type });
  if (typeof blob.text !== 'function') {
    Object.defineProperty(blob, 'text', {
      configurable: true,
      value: () => Promise.resolve(text),
    });
  }
  return blob;
}

function flushActivityWithVersion(
  http: HttpTestingController,
  options: { fileName: string; contentType: string },
): void {
  http.expectOne(`/api/files/${FILE_ID}/activity`).flush({
    fileObjectId: FILE_ID,
    items: [{
      id: VERSION_ID,
      kind: 'versionCreated',
      actorDisplayName: 'File Editor',
      occurredAt: '2026-09-01T13:00:00Z',
      version: {
        versionId: VERSION_ID,
        versionNumber: 2,
        fileName: options.fileName,
        contentType: options.contentType,
        sizeBytes: 128,
        createdAt: '2026-09-01T13:00:00Z',
        isCurrent: true,
      },
    }],
  });
}

function clickVersion(fixture: ComponentFixture<FileActivityPanelComponent>): void {
  const button = (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="files-activity-view-version"]',
  ) as HTMLButtonElement;
  button.click();
  fixture.detectChanges();
}

describe('FileActivityPanelComponent issue #363', () => {
  beforeEach(() => window.localStorage.setItem('aip.locale', 'en'));

  afterEach(() => {
    window.localStorage.removeItem('aip.locale');
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders a chronological typed timeline while dropping raw Audit and storage fields', async () => {
    const fixture = await render();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne(`/api/files/${FILE_ID}/activity`);
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);

    request.flush({
      fileObjectId: FILE_ID,
      items: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          kind: 'sharingChanged',
          actorDisplayName: 'Workspace Admin',
          occurredAt: '2026-09-01T12:00:00Z',
          sharing: {
            change: 'recipientGranted',
            accessState: 'workspace',
            sharingVersion: 3,
          },
          metadataJson: '{"recipientEmail":"secret@example.com"}',
          ipAddress: '192.0.2.44',
          correlationId: 'private-correlation-id',
        },
        {
          id: VERSION_ID,
          kind: 'versionCreated',
          actorDisplayName: 'File Editor',
          occurredAt: '2026-09-01T13:00:00Z',
          version: {
            versionId: VERSION_ID,
            versionNumber: 2,
            fileName: 'research-notes.txt',
            contentType: 'text/plain',
            sizeBytes: 128,
            createdAt: '2026-09-01T13:00:00Z',
            isCurrent: true,
            viewPath: 'https://attacker.invalid/raw-storage-object',
            storageKey: 'tenant/private/raw-key',
          },
        },
      ],
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const text = host.textContent ?? '';
    const events = Array.from(host.querySelectorAll<HTMLElement>('[data-activity-kind]'));

    expect(events.map((event) => event.dataset['activityKind'])).toEqual([
      'versionCreated',
      'sharingChanged',
    ]);
    expect(text).toContain('Version created');
    expect(text).toContain('Version 2');
    expect(text).toContain('File Editor');
    expect(text).toContain('Recipient access granted');
    expect(text).toContain('Workspace Admin');
    expect(text).toContain('Sharing revision 3');
    expect(text).not.toContain('secret@example.com');
    expect(text).not.toContain('192.0.2.44');
    expect(text).not.toContain('private-correlation-id');
    expect(text).not.toContain('tenant/private/raw-key');
    expect(host.querySelector('a[href*="attacker.invalid"]')).toBeNull();
  });

  it('reconstructs historical version viewing from authorized identities instead of trusting a server URL', async () => {
    const fixture = await render();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`/api/files/${FILE_ID}/activity`).flush({
      fileObjectId: FILE_ID,
      items: [{
        id: VERSION_ID,
        kind: 'versionCreated',
        actorDisplayName: 'File Editor',
        occurredAt: '2026-09-01T13:00:00Z',
        version: {
          versionId: VERSION_ID,
          versionNumber: 2,
          fileName: 'research-notes.txt',
          contentType: 'text/plain',
          sizeBytes: 12,
          createdAt: '2026-09-01T13:00:00Z',
          isCurrent: true,
          viewPath: 'https://attacker.invalid/should-not-be-used',
        },
      }],
    });
    fixture.detectChanges();

    clickVersion(fixture);

    const versionRequest = http.expectOne(`/api/files/${FILE_ID}/versions/${VERSION_ID}/content`);
    expect(versionRequest.request.method).toBe('GET');
    expect(versionRequest.request.withCredentials).toBe(true);
    http.expectNone('https://attacker.invalid/should-not-be-used');
    versionRequest.flush(browserTextBlob('version two', 'text/plain'));
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Version 2');
    expect(text).toContain('version two');
  });

  it('opens a historical PDF only after the returned Blob MIME matches the PDF metadata', async () => {
    const fixture = await render();
    const http = TestBed.inject(HttpTestingController);
    flushActivityWithVersion(http, { fileName: 'brief.pdf', contentType: 'application/pdf' });
    fixture.detectChanges();

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:historical-pdf');
    clickVersion(fixture);
    const versionRequest = http.expectOne(`/api/files/${FILE_ID}/versions/${VERSION_ID}/content`);
    versionRequest.flush(new Blob(['pdf'], { type: 'application/pdf' }));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const link = host.querySelector('[data-testid="files-version-preview-pdf-link"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('blob:historical-pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(host.querySelector('iframe')).toBeNull();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it('fails closed when historical PDF metadata does not match the returned Blob MIME', async () => {
    const fixture = await render();
    const http = TestBed.inject(HttpTestingController);
    flushActivityWithVersion(http, { fileName: 'brief.pdf', contentType: 'application/pdf' });
    fixture.detectChanges();

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:must-not-be-used');
    clickVersion(fixture);
    const versionRequest = http.expectOne(`/api/files/${FILE_ID}/versions/${VERSION_ID}/content`);
    versionRequest.flush(new Blob(['<html>active</html>'], { type: 'text/html' }));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="files-version-preview-pdf-link"]')).toBeNull();
    expect(host.textContent).toContain('The returned file type did not match this version.');
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('does not fetch or mint a Blob URL for an unsupported historical active-content type', async () => {
    const fixture = await render();
    const http = TestBed.inject(HttpTestingController);
    flushActivityWithVersion(http, { fileName: 'payload.xhtml', contentType: 'application/xhtml+xml' });
    fixture.detectChanges();

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:must-not-be-used');
    clickVersion(fixture);

    http.expectNone(`/api/files/${FILE_ID}/versions/${VERSION_ID}/content`);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Preview is not available for this file type.');
    expect(host.querySelector('a[href^="blob:"]')).toBeNull();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('fails closed when activity access is revoked', async () => {
    const fixture = await render();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`/api/files/${FILE_ID}/activity`).flush(
      { code: 'FILE_NOT_FOUND', message: 'File not found.' },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="files-activity-error"]')).not.toBeNull();
    expect(host.textContent).toContain('You no longer have access to this file.');
    expect(host.querySelector('[data-testid="files-activity-timeline"]')).toBeNull();
  });
});