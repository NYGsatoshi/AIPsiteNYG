import { Component, computed, effect, inject, signal } from '@angular/core';

import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';
import { ActiveWorkspaceFacade } from '../../../core/workspace/active-workspace.facade';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { AppDataGridColumnDef } from '../../../shared/grid/app-data-grid/app-data-grid.types';
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
  imports: [AipFileUploaderComponent, AppDataGridComponent, AttachmentPickerDialogComponent, FileQuotaStateComponent, RecentFilesListComponent],
  templateUrl: './files-page.component.html',
  styleUrl: './files-page.component.scss'
})
export class FilesPageComponent {
  private readonly facade = inject(FilesFacade);
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);

  readonly page = this.facade.page;
  readonly syncfusionUploaderEnabled = this.flags.syncfusionUploaderEnabled;
  readonly density = signal<FileListDensity>('comfortable');
  readonly selectedCount = signal(0);
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
      { field: 'createdAtLabel', headerName: 'Modified', flex: 1, minWidth: 150 },
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
      pageFacade.loadPageFilesForWorkspace?.call(pageFacade, this.activeWorkspace.activeWorkspace()?.id);
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
    this.selectedCount.set(event.rows.length);
  }

  handleGridAction(event: { actionId: string; row: FileViewModel }): void {
    if ((event.actionId === 'open' || event.actionId === 'download') && event.row.canonicalFileId) {
      this.downloadFile(event.row.canonicalFileId);
    }
  }
}
