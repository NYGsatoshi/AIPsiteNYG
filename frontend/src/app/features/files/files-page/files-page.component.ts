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
import { AuthSessionFacade } from '../../../core/auth/auth-session.facade';
import { RealtimeFacade } from '../../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../../core/workspace/active-workspace.facade';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { AppDataGridColumnDef } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AipDialogComponent } from '../../../shared/ui/aip-dialog/aip-dialog.component';
import { AipFilterChipComponent } from '../../../shared/ui/aip-filter-chip/aip-filter-chip.component';
import { AipFileUploaderComponent } from '../../../shared/ui/adapters/syncfusion/aip-file-uploader.component';
import { AttachmentPickerDialogComponent } from '../attachment-picker-dialog/attachment-picker-dialog.component';
import { FilePreviewService } from '../file-preview.service';
import { FileQuotaStateComponent } from '../file-quota-state/file-quota-state.component';
import { FilesFacade } from '../files.facade';
import { RecentFilesListComponent } from '../recent-files-list/recent-files-list.component';
import {
  FILE_SCAN_STATUS_LABELS,
  FileSearchFilters,
  FileSearchKindFilter,
  FileSearchModifiedFilter,
  FileSearchOwnerFilter,
  FileViewModel,
} from '../files.types';

type FileListOptionalColumn = 'type' | 'size' | 'scan';
type FileListDensity = 'comfortable' | 'compact';
type FilePreviewState = 'idle' | 'loading' | 'ready' | 'unsupported' | 'failed';
type FilePreviewRenderer = 'image' | 'pdf' | 'video' | 'text' | 'unsupported';
type FileInspectorTab = 'preview' | 'details' | 'activity';

const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;
const PREVIEW_OVERLAY_MAX_WIDTH = 860;

@Component({
  selector: 'app-files-page',
  standalone: true,
  imports: [
    A11yModule,
    AipDialogComponent,
    AipFilterChipComponent,
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
  private readonly authSession = inject(AuthSessionFacade);
  private readonly realtime = inject(RealtimeFacade);

  readonly page = this.facade.page;
  readonly search = this.facade.search;
  readonly syncfusionUploaderEnabled = this.flags.syncfusionUploaderEnabled;
  readonly fileScanStatusLabels = FILE_SCAN_STATUS_LABELS;
  readonly searchQuery = signal('');
  readonly searchKind = signal<FileSearchKindFilter>('all');
  readonly searchModified = signal<FileSearchModifiedFilter>('any');
  readonly searchOwner = signal<FileSearchOwnerFilter>('any');
  readonly activeWorkspaceLabel = computed(() => this.activeWorkspace.activeWorkspace()?.label ?? 'Current Workspace');
  readonly searchApplied = computed(() => this.search().status !== 'idle');
  readonly displayedList = computed(() => {
    const search = this.search();
    if (search.status !== 'idle') {
      return {
        files: search.files,
        page: search.page,
        pageSize: search.pageSize,
        totalCount: search.totalCount,
        hasMore: search.hasMore,
      };
    }
    const page = this.page();
    return {
      files: page.recentFiles,
      page: page.page,
      pageSize: page.pageSize,
      totalCount: page.totalCount,
      hasMore: page.hasMore,
    };
  });
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
  readonly previewActionStatus = signal('');
  readonly previewOverlay = signal(this.isCompactViewport());
  readonly previewOpen = computed(() => this.previewFile() !== null);
  readonly inspectorTab = signal<FileInspectorTab>('preview');
  readonly inspectorTabs: readonly FileInspectorTab[] = ['preview', 'details', 'activity'];
  readonly fileLocationLabel = computed(() =>
    this.activeWorkspace.activeWorkspace()?.label ?? 'Current Workspace');
  readonly previewCanDownload = computed(() => {
    const file = this.previewFile();
    return !!file?.canonicalFileId && file.downloadPolicy === 'available' &&
      file.scanStatus === 'allowed' && file.capabilities.includes('download') &&
      file.downloadState !== 'pending';
  });
  readonly previewCanOpen = computed(() => this.previewState() === 'ready' && !!this.previewUrl());
  readonly researchHandoffHref = computed(() => {
    const file = this.previewFile();
    const workspaceId = this.activeWorkspace.activeWorkspace()?.id;
    if (!workspaceId || !file?.canonicalFileId) {
      return null;
    }
    const params = new URLSearchParams({
      sourceFileObjectId: file.canonicalFileId,
      sourceFileName: file.originalFileName,
    });
    return `/workspaces/${encodeURIComponent(workspaceId)}/research/new?${params.toString()}`;
  });
  readonly previewCanShare = computed(() =>
    this.previewFile() !== null && typeof navigator !== 'undefined' && typeof navigator.share === 'function');

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
    const page = this.displayedList();
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
    const unregisterSearchDraftClearer = this.realtime.registerProtectedStateClearer?.(
      'files-page-search-draft',
      () => this.resetSearchControls(),
    );
    effect(() => {
      const pageFacade = this.facade as FilesFacade & {
        loadPageFilesForWorkspace?: (workspaceId: string | undefined) => void;
      };
      const workspaceId = this.activeWorkspace.activeWorkspace()?.id;
      this.resetSearchControls();
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
    effect(() => {
      // Search responses are server-authorized snapshots. Never keep a
      // selection or preview from the snapshot they replace.
      this.facade.searchRevision();
      if (this.search().status === 'idle') {
        this.resetSearchControls();
      }
      this.closePreview(false);
      this.clearSelection();
      this.closeDeleteDialog();
    });
    this.destroyRef.onDestroy(() => {
      unregisterSearchDraftClearer?.();
      this.closePreview(false);
    });
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

  updateSearchQuery(event: Event): void {
    this.searchQuery.set(event.target instanceof HTMLInputElement ? event.target.value : '');
  }

  updateSearchKind(event: Event): void {
    this.searchKind.set((event.target as HTMLSelectElement).value as FileSearchKindFilter);
  }

  updateSearchModified(event: Event): void {
    this.searchModified.set((event.target as HTMLSelectElement).value as FileSearchModifiedFilter);
  }

  updateSearchOwner(event: Event): void {
    this.searchOwner.set((event.target as HTMLSelectElement).value as FileSearchOwnerFilter);
  }

  submitFileSearch(event: Event): void {
    event.preventDefault();
    this.applyFileSearch();
  }

  clearFileSearch(): void {
    this.searchQuery.set('');
    this.searchKind.set('all');
    this.searchModified.set('any');
    this.searchOwner.set('any');
    this.facade.clearFileSearch();
  }

  removeSearchFilter(filter: 'kind' | 'modified' | 'owner'): void {
    const applied = this.search().filters;
    // Chips describe the last server request, so removal starts from that
    // request rather than combining it with unrelated, unsubmitted drafts.
    this.searchQuery.set(applied.query);
    this.searchKind.set(filter === 'kind' ? 'all' : applied.kind);
    this.searchModified.set(filter === 'modified' ? 'any' : applied.modified);
    this.searchOwner.set(filter === 'owner' ? 'any' : applied.owner);
    this.applyFileSearch();
  }

  searchKindLabel(kind: FileSearchKindFilter): string {
    return ({
      all: 'Any type',
      document: 'Documents',
      image: 'Images',
      pdf: 'PDF',
      video: 'Video',
      archive: 'Archives',
    } as const)[kind];
  }

  searchModifiedLabel(modified: FileSearchModifiedFilter): string {
    return ({
      any: 'Any time',
      last7Days: 'Last 7 days',
      last30Days: 'Last 30 days',
      last90Days: 'Last 90 days',
    } as const)[modified];
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
    this.selectedFiles.set(this.displayedList().files.filter((file) => selectedIds.has(file.id)));
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
    this.inspectorTab.set('preview');
    this.previewRenderer.set(this.previewRendererFor(file));
    this.previewText.set('');
    this.previewMessage.set('');
    this.previewActionStatus.set('');

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
      if (!result.ok || !result.blob) {
        this.previewState.set('failed');
        this.previewMessage.set(result.message || 'Preview content was unavailable.');
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
    this.inspectorTab.set('preview');
    this.previewState.set('idle');
    this.previewRenderer.set('unsupported');
    this.previewText.set('');
    this.previewMessage.set('');
    this.previewActionStatus.set('');

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

  selectInspectorTab(tab: FileInspectorTab): void {
    if (!this.previewFile()) {
      return;
    }
    this.inspectorTab.set(tab);
  }

  handleInspectorTabKeydown(event: KeyboardEvent, currentTab: FileInspectorTab): void {
    const currentIndex = this.inspectorTabs.indexOf(currentTab);
    let targetIndex = currentIndex;

    switch (event.key) {
      case 'ArrowRight':
        targetIndex = (currentIndex + 1) % this.inspectorTabs.length;
        break;
      case 'ArrowLeft':
        targetIndex = (currentIndex - 1 + this.inspectorTabs.length) % this.inspectorTabs.length;
        break;
      case 'Home':
        targetIndex = 0;
        break;
      case 'End':
        targetIndex = this.inspectorTabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const targetTab = this.inspectorTabs[targetIndex] ?? currentTab;
    this.inspectorTab.set(targetTab);
    const tabList = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.parentElement
      : null;
    queueMicrotask(() => {
      tabList
        ?.querySelector<HTMLButtonElement>(`[data-inspector-tab="${targetTab}"]`)
        ?.focus();
    });
  }

  fileAccessLabel(file: FileViewModel): string {
    return file.downloadPolicy === 'available' &&
      file.scanStatus === 'allowed' &&
      file.capabilities.includes('download')
      ? 'Authorized download'
      : 'Restricted';
  }

  copyPreviewCitation(): void {
    const file = this.previewFile();
    if (!file?.canonicalFileId) {
      this.previewActionStatus.set('Citation is not available for this file.');
      return;
    }
    const citation = this.previewCitationText(file);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clipboard && typeof clipboard.writeText === 'function') {
      void clipboard.writeText(citation).then(
        () => this.previewActionStatus.set('Citation copied.'),
        () => this.previewActionStatus.set(this.fallbackCopyText(citation) ? 'Citation copied.' : 'Citation copy is not available in this browser.'),
      );
      return;
    }
    this.previewActionStatus.set(this.fallbackCopyText(citation) ? 'Citation copied.' : 'Citation copy is not available in this browser.');
  }

  sharePreview(): void {
    const file = this.previewFile();
    if (!file || typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      this.previewActionStatus.set('Sharing is not available in this browser.');
      return;
    }
    void navigator.share({
      title: file.originalFileName,
      text: this.previewCitationText(file),
    }).then(
      () => this.previewActionStatus.set('Share sheet opened.'),
      () => this.previewActionStatus.set('Sharing was cancelled or unavailable.'),
    );
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
    const current = this.displayedList();
    if (current.page <= 1) {
      return;
    }
    this.closePreview(false);
    this.clearSelection();
    if (this.searchApplied()) {
      this.facade.goToSearchPage(current.page - 1);
    } else {
      this.facade.goToPage(current.page - 1);
    }
  }

  goToNextPage(): void {
    const current = this.displayedList();
    if (!current.hasMore) {
      return;
    }
    this.closePreview(false);
    this.clearSelection();
    if (this.searchApplied()) {
      this.facade.goToSearchPage(current.page + 1);
    } else {
      this.facade.goToPage(current.page + 1);
    }
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

  private applyFileSearch(): void {
    const workspaceId = this.activeWorkspace.activeWorkspace()?.id;
    if (!workspaceId) {
      this.facade.clearFileSearch();
      return;
    }
    const filters: FileSearchFilters = {
      query: this.searchQuery(),
      kind: this.searchKind(),
      modified: this.searchModified(),
      owner: this.searchOwner(),
    };
    this.facade.searchFilesForWorkspace(
      workspaceId,
      filters,
      this.authSession.currentUser()?.userId ?? null,
    );
  }

  private resetSearchControls(): void {
    this.searchQuery.set('');
    this.searchKind.set('all');
    this.searchModified.set('any');
    this.searchOwner.set('any');
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

    const objectUrlAvailable = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    if (objectUrlAvailable) {
      const objectUrl = URL.createObjectURL(blob);
      this.previewObjectUrl = objectUrl;
      this.previewUrl.set(objectUrl);
      this.previewResourceUrl.set(renderer === 'pdf' ? this.sanitizer.bypassSecurityTrustResourceUrl(objectUrl) : null);
    } else if (renderer !== 'text') {
      this.previewState.set('failed');
      this.previewMessage.set('This browser cannot create a local preview URL.');
      return;
    }

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

    this.previewState.set('ready');
  }

  private previewCitationText(file: FileViewModel): string {
    const modified = file.modifiedAtLabel ? `; modified ${file.modifiedAtLabel}` : '';
    return `“${file.originalFileName}” — ${file.uploadedByDisplay}${modified}; AIPsite file ${file.canonicalFileId ?? file.id}`;
  }

  private fallbackCopyText(text: string): boolean {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
      return false;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      textarea.remove();
      active?.focus({ preventScroll: true });
    }
    return copied;
  }

  private failPreviewForContentType(): void {
    this.previewState.set('failed');
    this.previewMessage.set('The downloaded content type did not match the file preview type.');
  }

  private isCompactViewport(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= PREVIEW_OVERLAY_MAX_WIDTH;
  }
}
