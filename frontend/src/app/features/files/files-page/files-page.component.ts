import { A11yModule } from '@angular/cdk/a11y';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';

import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';
import { ActiveWorkspaceFacade } from '../../../core/workspace/active-workspace.facade';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { AppDataGridColumnDef } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AipDialogComponent } from '../../../shared/ui/aip-dialog/aip-dialog.component';
import { AipFileUploaderComponent } from '../../../shared/ui/adapters/syncfusion/aip-file-uploader.component';
import { AttachmentPickerDialogComponent } from '../attachment-picker-dialog/attachment-picker-dialog.component';
import { FilePreviewService } from '../file-preview.service';
import { FileQuotaStateComponent } from '../file-quota-state/file-quota-state.component';
import { FilesFacade } from '../files.facade';
import { RecentFilesListComponent } from '../recent-files-list/recent-files-list.component';
import { FILE_SCAN_STATUS_LABELS, FileViewModel } from '../files.types';

type FileListOptionalColumn = 'type' | 'size' | 'scan';
type FileListDensity = 'comfortable' | 'compact';
type FilePreviewState = 'idle' | 'loading' | 'ready' | 'unsupported' | 'failed';
type FilePreviewRenderer = 'image' | 'pdf' | 'video' | 'text' | 'unsupported';

const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;
const PREVIEW_OVERLAY_MAX_WIDTH = 860;

@Component({
  selector: 'app-files-page',
  standalone: true,
  imports: [
    A11yModule,
    AipDialogComponent,
    AipFileUploaderComponent,
    AppDataGridComponent,
    AttachmentPickerDialogComponent,
    FileQuotaStateComponent,
    RecentFilesListComponent,
  ],
  templateUrl: './files-page.component.html',
  styleUrl: './files-page.component.scss'
})
export class FilesPageComponent {
  @ViewChild(AppDataGridComponent) private dataGrid?: AppDataGridComponent<FileViewModel>;
  @ViewChild('previewPane') private previewPane?: ElementRef<HTMLElement>;

  private readonly facade = inject(FilesFacade);
  private readonly previewService = inject(FilePreviewService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);

  readonly page = this.facade.page;
  readonly syncfusionUploaderEnabled = this.flags.syncfusionUploaderEnabled;
  readonly density = signal<FileListDensity>('comfortable');
  readonly selectedFiles = signal<readonly FileViewModel[]>([]);
  readonly selectedCount = computed(() => this.selectedFiles().length);
  readonly selectedFileIds = computed<ReadonlySet<string>>(() =>
    new Set(this.selectedFiles().map((file) => file.id)));
  readonly canDeleteSelection = computed(() => {
    const selected = this.selectedFiles();
    return selected.length > 0 && selected.every((file) => file.canDelete === true && !!file.canonicalFileId);
  });
  readonly downloadableSelection = computed(() => {
    const selected = this.selectedFiles();
    const file = selected.length === 1 ? selected[0] : undefined;
    return file && file.canonicalFileId && file.downloadPolicy === 'available' &&
      file.scanStatus === 'allowed' && file.downloadState !== 'pending'
      ? file
      : null;
  });

  readonly previewFile = signal<FileViewModel | null>(null);
  readonly previewState = signal<FilePreviewState>('idle');
  readonly previewRenderer = signal<FilePreviewRenderer>('unsupported');
  readonly previewUrl = signal<string | null>(null);
  readonly previewResourceUrl = signal<SafeResourceUrl | null>(null);
  readonly previewText = signal('');
  readonly previewMessage = signal('');
  readonly previewOverlay = signal(this.isCompactViewport());
  readonly previewOpen = computed(() => this.previewFile() !== null);
  readonly previewCanDownload = computed(() => {
    const file = this.previewFile();
    return !!file?.canonicalFileId && file.downloadPolicy === 'available' &&
      file.scanStatus === 'allowed' && file.capabilities.includes('download') &&
      file.downloadState !== 'pending';
  });

  readonly deleteDialogOpen = signal(false);
  readonly deleteTargets = signal<readonly FileViewModel[]>([]);
  readonly deleteState = this.facade.deleteState;
  readonly deleteBusy = computed(() => this.deleteState().state === 'pending');
  readonly deleteDialogTitle = computed(() =>
    this.deleteTargets().length === 1 ? 'Delete file?' : `Delete ${this.deleteTargets().length} files?`);
  readonly deleteDialogDescription = computed(() => {
    const targets = this.deleteTargets();
    if (targets.length === 1) {
      return `Delete ${targets[0]?.originalFileName ?? 'the selected file'}?`;
    }
    return `Delete ${targets.length} selected files? Files are deleted one at a time; this is not an atomic batch.`;
  });
  readonly totalPages = computed(() => {
    const page = this.page();
    return Math.max(1, Math.ceil(page.totalCount / Math.max(1, page.pageSize)));
  });
  readonly optionalColumns = [
    { id: 'type' as const, label: 'Type' },
    { id: 'size' as const, label: 'Size' },
    { id: 'scan' as const, label: 'Scan details' },
  ];
  private readonly visibleOptionalColumns = signal<ReadonlySet<FileListOptionalColumn>>(new Set());
  private previewRequest: Subscription | null = null;
  private previewGeneration = 0;
  private previewObjectUrl: string | null = null;
  private previewReturnFocus: HTMLElement | null = null;

  readonly columns = computed<readonly AppDataGridColumnDef<FileViewModel>[]>(() => {
    const visible = this.visibleOptionalColumns();
    const columns: AppDataGridColumnDef<FileViewModel>[] = [
      {
        colId: 'name',
        headerName: 'Name',
        flex: 2,
        minWidth: 220,
        actions: (row) => [{
          id: 'open',
          label: row.originalFileName,
          row,
        }],
      },
      { field: 'modifiedAtLabel', headerName: 'Modified', flex: 1, minWidth: 150 },
      { field: 'uploadedByDisplay', headerName: 'Owner', flex: 1, minWidth: 140 },
      {
        colId: 'status',
        headerName: 'Status',
        minWidth: 130,
        valueGetter: ({ data }) => data ? FILE_SCAN_STATUS_LABELS[data.scanStatus] : '',
      },
    ];

    if (visible.has('type')) {
      columns.push({ field: 'contentType', headerName: 'Type', flex: 1, minWidth: 160 });
    }
    if (visible.has('size')) {
      columns.push({
        field: 'sizeBytes',
        headerName: 'Size',
        minWidth: 100,
        valueFormatter: ({ value }) => `${Math.round(Number(value ?? 0) / 1024)} KB`,
      });
    }
    if (visible.has('scan')) {
      columns.push({ field: 'scanStatus', headerName: 'Scan details', minWidth: 130 });
    }

    return columns;
  });

  constructor() {
    effect(() => {
      const pageFacade = this.facade as FilesFacade & {
        loadPageFilesForWorkspace?: (workspaceId: string | undefined) => void;
      };
      const workspaceId = this.activeWorkspace.activeWorkspace()?.id;
      this.closePreview(false);
      this.clearSelection();
      this.closeDeleteDialog();
      pageFacade.loadPageFilesForWorkspace?.call(pageFacade, workspaceId);
    });
    effect(() => {
      // A server inventory replacement can revoke a capability or remove a row.
      // Selection and preview never survive that authoritative reload.
      this.facade.inventoryRevision();
      this.closePreview(false);
      this.clearSelection();
      this.closeDeleteDialog();
    });
    this.destroyRef.onDestroy(() => this.closePreview(false));
  }

  @HostListener('window:resize')
  handleWindowResize(): void {
    this.previewOverlay.set(this.isCompactViewport());
  }

  @HostListener('document:keydown.escape', ['$event'])
  handleEscape(event: KeyboardEvent): void {
    if (!this.previewOpen() || this.deleteDialogOpen()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.closePreview();
  }

  acceptUpload(files: readonly File[]): void {
    this.facade.uploadFiles(files);
  }

  cancelUpload(clientRequestId: string): void {
    this.facade.cancelUpload(clientRequestId);
  }

  retryUpload(clientRequestId: string): void {
    this.facade.retryUpload(clientRequestId);
  }

  downloadFile(fileObjectId: string): void {
    this.facade.downloadFile(fileObjectId);
  }

  isColumnVisible(column: FileListOptionalColumn): boolean {
    return this.visibleOptionalColumns().has(column);
  }

  toggleColumn(column: FileListOptionalColumn, visible: boolean): void {
    this.visibleOptionalColumns.update((current) => {
      const next = new Set(current);
      if (visible) {
        next.add(column);
      } else {
        next.delete(column);
      }
      return next;
    });
  }

  setDensity(density: FileListDensity): void {
    this.density.set(density);
  }

  handleSelectionChanged(event: { rows: readonly FileViewModel[] }): void {
    this.selectedFiles.set([...event.rows]);
  }

  handleMobileSelection(event: { file: FileViewModel; selected: boolean }): void {
    const selectedIds = new Set(this.selectedFiles().map((file) => file.id));
    if (event.selected) {
      selectedIds.add(event.file.id);
    } else {
      selectedIds.delete(event.file.id);
    }
    this.selectedFiles.set(this.page().recentFiles.filter((file) => selectedIds.has(file.id)));
  }

  clearSelection(): void {
    this.selectedFiles.set([]);
    this.dataGrid?.clearSelection();
  }

  openPreview(file: FileViewModel): void {
    this.capturePreviewReturnFocus();
    this.cancelPreviewRequest();
    this.revokePreviewObjectUrl();
    this.previewFile.set(file);
    this.previewRenderer.set(this.previewRendererFor(file));
    this.previewText.set('');
    this.previewMessage.set('');

    const accessMessage = this.previewAccessMessage(file);
    if (accessMessage) {
      this.previewState.set('failed');
      this.previewMessage.set(accessMessage);
      return;
    }

    if (this.previewRenderer() === 'unsupported') {
      this.previewState.set('unsupported');
      this.previewMessage.set('This file type does not have an inline preview. Download it explicitly to open it in another application.');
      return;
    }

    const fileObjectId = file.canonicalFileId;
    if (!fileObjectId) {
      this.previewState.set('failed');
      this.previewMessage.set('Preview is not available until the canonical file is ready.');
      return;
    }

    this.previewState.set('loading');
    const generation = this.previewGeneration;
    const request = this.previewService.load(fileObjectId).subscribe((result) => {
      if (generation !== this.previewGeneration || this.previewFile()?.id !== file.id) {
        return;
      }
      this.previewRequest = null;
      if (!result.ok) {
        this.previewState.set('failed');
        this.previewMessage.set(result.message);
        return;
      }
      this.applyPreviewBlob(file, result.blob, generation);
    });
    this.previewRequest = request;
  }

  closePreview(returnFocus = true): void {
    const target = returnFocus ? this.previewReturnFocus : null;
    this.previewReturnFocus = null;
    this.cancelPreviewRequest();
    this.revokePreviewObjectUrl();
    this.previewFile.set(null);
    this.previewState.set('idle');
    this.previewRenderer.set('unsupported');
    this.previewText.set('');
    this.previewMessage.set('');

    if (target) {
      queueMicrotask(() => {
        if (!target.isConnected) {
          return;
        }
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
      });
    }
  }

  downloadPreviewFile(): void {
    const file = this.previewFile();
    if (this.previewCanDownload() && file?.canonicalFileId) {
      this.downloadFile(file.canonicalFileId);
    }
  }

  downloadSelectedFile(): void {
    const file = this.downloadableSelection();
    if (file?.canonicalFileId) {
      this.downloadFile(file.canonicalFileId);
    }
  }

  openDeleteConfirmation(): void {
    if (!this.canDeleteSelection() || this.deleteBusy()) {
      return;
    }
    this.deleteTargets.set([...this.selectedFiles()]);
    this.deleteDialogOpen.set(true);
  }

  closeDeleteDialog(): void {
    if (this.deleteBusy()) {
      return;
    }
    this.deleteDialogOpen.set(false);
    this.deleteTargets.set([]);
  }

  confirmDelete(): void {
    const targets = this.deleteTargets();
    if (targets.length === 0 || this.deleteBusy()) {
      return;
    }
    this.facade.deleteFiles(targets, () => {
      this.deleteDialogOpen.set(false);
      this.deleteTargets.set([]);
      this.clearSelection();
    });
  }

  goToPreviousPage(): void {
    const current = this.page();
    if (current.page <= 1) {
      return;
    }
    this.closePreview(false);
    this.clearSelection();
    this.facade.goToPage(current.page - 1);
  }

  goToNextPage(): void {
    const current = this.page();
    if (!current.hasMore) {
      return;
    }
    this.closePreview(false);
    this.clearSelection();
    this.facade.goToPage(current.page + 1);
  }

  handleGridAction(event: { actionId: string; row: FileViewModel }): void {
    if (event.actionId === 'open') {
      this.openPreview(event.row);
      return;
    }
    if (event.actionId === 'download' && event.row.canonicalFileId) {
      this.downloadFile(event.row.canonicalFileId);
    }
  }

  formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
      return `${Math.round(bytes / 1024 / 1024)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  private capturePreviewReturnFocus(): void {
    if (typeof document === 'undefined') {
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !this.previewPane?.nativeElement.contains(active)) {
      this.previewReturnFocus = active;
    }
  }

  private cancelPreviewRequest(): void {
    this.previewGeneration++;
    this.previewRequest?.unsubscribe();
    this.previewRequest = null;
  }

  private revokePreviewObjectUrl(): void {
    if (this.previewObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(this.previewObjectUrl);
    }
    this.previewObjectUrl = null;
    this.previewUrl.set(null);
    this.previewResourceUrl.set(null);
  }

  private previewAccessMessage(file: FileViewModel): string | null {
    if (!file.canonicalFileId) {
      return 'Preview is not available until the canonical file is ready.';
    }
    if (file.scanStatus === 'pending' || file.scanStatus === 'unavailable') {
      return 'Preview is unavailable until file scanning completes.';
    }
    if (file.scanStatus === 'blocked') {
      return 'Preview is blocked by file scan state.';
    }
    if (file.downloadPolicy !== 'available' || !file.capabilities.includes('download')) {
      return 'You do not have permission to preview this file.';
    }
    return null;
  }

  private previewRendererFor(file: FileViewModel): FilePreviewRenderer {
    if (file.kind === 'image' || file.kind === 'svg') {
      return 'image';
    }
    if (file.kind === 'pdf') {
      return 'pdf';
    }
    if (file.kind === 'video') {
      return 'video';
    }
    if (this.isTextLike(file)) {
      return 'text';
    }
    return 'unsupported';
  }

  private isTextLike(file: FileViewModel): boolean {
    const contentType = file.contentType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
    if (contentType.startsWith('text/')) {
      return true;
    }
    if (['application/json', 'application/xml', 'application/yaml', 'application/x-yaml', 'application/x-ndjson'].includes(contentType)) {
      return true;
    }
    const fileName = file.originalFileName.toLowerCase();
    return ['.txt', '.md', '.csv', '.log', '.json', '.xml', '.yaml', '.yml'].some((extension) => fileName.endsWith(extension));
  }

  private applyPreviewBlob(file: FileViewModel, blob: Blob, generation: number): void {
    const renderer = this.previewRenderer();
    const actualContentType = blob.type.toLowerCase();

    if (renderer === 'text') {
      const truncated = blob.size > TEXT_PREVIEW_MAX_BYTES;
      void blob.slice(0, TEXT_PREVIEW_MAX_BYTES).text().then((text) => {
        if (generation !== this.previewGeneration || this.previewFile()?.id !== file.id) {
          return;
        }
        this.previewText.set(text);
        this.previewMessage.set(truncated ? 'Text preview is limited to the first 512 KB.' : '');
        this.previewState.set('ready');
      }).catch(() => {
        if (generation === this.previewGeneration && this.previewFile()?.id === file.id) {
          this.previewState.set('failed');
          this.previewMessage.set('The text preview could not be decoded.');
        }
      });
      return;
    }

    if (renderer === 'image' && !actualContentType.startsWith('image/')) {
      this.failPreviewForContentType();
      return;
    }
    if (renderer === 'pdf' && actualContentType !== 'application/pdf') {
      this.failPreviewForContentType();
      return;
    }
    if (renderer === 'video' && !actualContentType.startsWith('video/')) {
      this.failPreviewForContentType();
      return;
    }
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      this.previewState.set('failed');
      this.previewMessage.set('This browser cannot create a local preview URL.');
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    this.previewObjectUrl = objectUrl;
    this.previewUrl.set(objectUrl);
    this.previewResourceUrl.set(renderer === 'pdf' ? this.sanitizer.bypassSecurityTrustResourceUrl(objectUrl) : null);
    this.previewState.set('ready');
  }

  private failPreviewForContentType(): void {
    this.previewState.set('failed');
    this.previewMessage.set('The downloaded content type did not match the file preview type.');
  }

  private isCompactViewport(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= PREVIEW_OVERLAY_MAX_WIDTH;
  }
}
