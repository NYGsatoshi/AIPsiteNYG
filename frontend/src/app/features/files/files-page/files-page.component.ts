import { Component, computed, effect, inject, signal, ViewChild } from '@angular/core';

import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';
import { ActiveWorkspaceFacade } from '../../../core/workspace/active-workspace.facade';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { AppDataGridColumnDef } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AipDialogComponent } from '../../../shared/ui/aip-dialog/aip-dialog.component';
import { AipFileUploaderComponent } from '../../../shared/ui/adapters/syncfusion/aip-file-uploader.component';
import { AttachmentPickerDialogComponent } from '../attachment-picker-dialog/attachment-picker-dialog.component';
import { FileQuotaStateComponent } from '../file-quota-state/file-quota-state.component';
import { FilesFacade } from '../files.facade';
import { RecentFilesListComponent } from '../recent-files-list/recent-files-list.component';
import { FILE_SCAN_STATUS_LABELS, FileViewModel } from '../files.types';

type FileListOptionalColumn = 'type' | 'size' | 'scan';
type FileListDensity = 'comfortable' | 'compact';

@Component({
  selector: 'app-files-page',
  standalone: true,
  imports: [AipDialogComponent, AipFileUploaderComponent, AppDataGridComponent, AttachmentPickerDialogComponent, FileQuotaStateComponent, RecentFilesListComponent],
  templateUrl: './files-page.component.html',
  styleUrl: './files-page.component.scss'
})
export class FilesPageComponent {
  @ViewChild(AppDataGridComponent) private dataGrid?: AppDataGridComponent<FileViewModel>;

  private readonly facade = inject(FilesFacade);
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
          disabled: row.downloadPolicy !== 'available' || row.scanStatus !== 'allowed' || row.downloadState === 'pending',
          disabledReason: row.downloadMessage,
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
      this.clearSelection();
      this.closeDeleteDialog();
      pageFacade.loadPageFilesForWorkspace?.call(pageFacade, workspaceId);
    });
    effect(() => {
      // A server inventory replacement can revoke a capability or remove a row.
      // Selection never survives that authoritative reload.
      this.facade.inventoryRevision();
      this.clearSelection();
      this.closeDeleteDialog();
    });
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
    this.clearSelection();
    this.facade.goToPage(current.page - 1);
  }

  goToNextPage(): void {
    const current = this.page();
    if (!current.hasMore) {
      return;
    }
    this.clearSelection();
    this.facade.goToPage(current.page + 1);
  }

  handleGridAction(event: { actionId: string; row: FileViewModel }): void {
    if ((event.actionId === 'open' || event.actionId === 'download') && event.row.canonicalFileId) {
      this.downloadFile(event.row.canonicalFileId);
    }
  }
}
