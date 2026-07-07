import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { AttachmentPickerDialogComponent } from '../attachment-picker-dialog/attachment-picker-dialog.component';
import { FileRowComponent } from '../file-row/file-row.component';
import { AIP_FILES_PAGE_MOCK } from '../files.facade';
import { DEFAULT_FILES, FILES_PAGE_SCENARIOS } from '../files.mock';
import { FilesPageViewModel } from '../files.types';
import { UploadDropZoneComponent } from '../upload-drop-zone/upload-drop-zone.component';
import { FilesPageComponent } from './files-page.component';

const renderFilesPage = async (page: FilesPageViewModel): Promise<ComponentFixture<FilesPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [FilesPageComponent],
    providers: [{ provide: AIP_FILES_PAGE_MOCK, useValue: page }]
  }).compileComponents();

  const fixture = TestBed.createComponent(FilesPageComponent);
  fixture.detectChanges();
  return fixture;
};

const textContent = (fixture: ComponentFixture<FilesPageComponent>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

const downloadButton = (fixture: ComponentFixture<FilesPageComponent>): HTMLButtonElement =>
  (fixture.nativeElement as HTMLElement).querySelector('[data-testid="download-action"]') as HTMLButtonElement;

describe('FilesPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('blocks a file over 100 MB in the upload UI', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.default);
    const dropZone = fixture.debugElement.query(By.directive(UploadDropZoneComponent))
      .componentInstance as UploadDropZoneComponent;

    dropZone.handleFiles([{ name: 'oversized-video.mp4', size: 101 * 1024 * 1024, type: 'video/mp4' } as File]);
    fixture.detectChanges();

    expect(textContent(fixture)).toContain('100 MBを超えるファイルはアップロードできません。');
    expect(textContent(fixture)).toContain('oversized-video.mp4');
  });

  it('disables accepted-size upload because backend upload is not wired in MVP0', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.default);
    const dropZone = fixture.debugElement.query(By.directive(UploadDropZoneComponent))
      .componentInstance as UploadDropZoneComponent;

    dropZone.handleFiles([{ name: 'sample.pdf', size: 1024, type: 'application/pdf' } as File]);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="file-upload-disabled"]')?.disabled).toBe(true);
    expect(textContent(fixture)).toContain('Upload not available in MVP0');
    expect(textContent(fixture)).not.toContain('sample.pdf');
  });

  it('disables download while scan is pending', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.scanPending);

    expect(downloadButton(fixture).disabled).toBe(true);
    expect(textContent(fixture)).toContain('安全確認中です。');
    expect(textContent(fixture)).toContain('安全確認が完了するまでダウンロードできません。');
  });

  it('disables download when scan is blocked', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.scanBlocked);

    expect(downloadButton(fixture).disabled).toBe(true);
    expect(textContent(fixture)).toContain('安全確認でブロックされたためダウンロードできません。');
  });

  it('enables download only when scan is allowed and capability exists', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.scanAllowed);

    expect(downloadButton(fixture).disabled).toBe(false);
  });

  it('shows a safe denied state when download capability is absent', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.downloadDenied);

    expect(downloadButton(fixture).disabled).toBe(true);
    expect(textContent(fixture)).toContain('このファイルをダウンロードする権限がありません。');
  });

  it('does not render inline preview elements', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.previewDisabled);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('object')).toBeNull();
    expect(host.querySelector('embed')).toBeNull();
    expect(host.querySelector('video')).toBeNull();
    expect(textContent(fixture)).toContain('プレビューはP0では無効です。');
  });

  it('does not render SVG as an image', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.noCanonicalFileIdYet);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('img[src$=".svg"]')).toBeNull();
    expect(textContent(fixture)).toContain('SVGは画像として表示しません。');
  });

  it('does not expose ZIP extract or preview actions', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.scanBlocked);
    const buttonLabels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).map(
      (button) => button.textContent ?? ''
    );

    expect(buttonLabels.join(' ')).not.toContain('展開');
    expect(buttonLabels.join(' ')).not.toContain('プレビュー');
    expect(textContent(fixture)).toContain('ZIPの展開、プレビュー、索引化は行いません。');
  });

  it('does not expose video streaming or play actions', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.downloadDenied);
    const buttonLabels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).map(
      (button) => button.textContent ?? ''
    );

    expect(buttonLabels.join(' ')).not.toContain('再生');
    expect(buttonLabels.join(' ')).not.toContain('ストリーミング');
    expect(textContent(fixture)).toContain('動画の再生、ストリーミング、公開リンクはありません。');
  });

  it('does not render internal storage keys, paths, or raw scan metadata', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.default);
    const text = textContent(fixture);

    expect(text).not.toContain('tenant-a/private/raw');
    expect(text).not.toContain('/var/lib/aipsite/private/raw');
    expect(text).not.toContain('engine=mock');
    expect(text).not.toContain('private-debug-value');
  });

  it('disables non-canonical files in the attachment picker', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.noCanonicalFileIdYet);
    const checkboxes = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      '[data-testid="attachment-picker-checkbox"]'
    );
    const picker = fixture.debugElement.query(By.directive(AttachmentPickerDialogComponent))
      .componentInstance as AttachmentPickerDialogComponent;

    expect(checkboxes[0].disabled).toBe(true);
    expect(checkboxes[1].disabled).toBe(false);

    picker.toggleFile(DEFAULT_FILES[3], true);
    picker.toggleFile(DEFAULT_FILES[0], true);
    fixture.detectChanges();

    expect(textContent(fixture)).toContain('canonical-file-001');
    expect(textContent(fixture)).not.toContain('file-row-004,');
  });

  it('requires explicit admin capability and audit reason for override', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.adminOverrideRequired);
    const row = fixture.debugElement.query(By.directive(FileRowComponent)).componentInstance as FileRowComponent;
    const action = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="admin-override-action"]'
    ) as HTMLButtonElement;

    expect(action.disabled).toBe(true);

    row.updateAuditReason('授業継続に必要な管理者確認');
    fixture.detectChanges();

    expect(action.disabled).toBe(false);
  });

  it('does not render admin override action without high privilege capability', async () => {
    const fixture = await renderFilesPage({
      ...FILES_PAGE_SCENARIOS.adminOverrideRequired,
      recentFiles: [
        {
          ...DEFAULT_FILES[2],
          capabilities: []
        }
      ]
    });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="admin-override-action"]')).toBeNull();
    expect(textContent(fixture)).toContain('高権限の許可がないため操作できません。');
  });

  it('mobile layout does not expose hidden unsafe actions', async () => {
    const fixture = await renderFilesPage(FILES_PAGE_SCENARIOS.mobile);
    (fixture.nativeElement as HTMLElement).style.width = '320px';
    fixture.detectChanges();
    const buttonLabels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).map(
      (button) => button.textContent ?? ''
    );

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="admin-override-action"]')).toBeNull();
    expect(buttonLabels.join(' ')).not.toContain('プレビュー');
    expect(buttonLabels.join(' ')).not.toContain('再生');
    expect(buttonLabels.join(' ')).not.toContain('展開');
  });
});
