import { Component, inject } from '@angular/core';

import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { AppDataGridColumnDef } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AipFileUploaderComponent } from '../../../shared/ui/adapters/syncfusion/aip-file-uploader.component';
import { AttachmentPickerDialogComponent } from '../attachment-picker-dialog/attachment-picker-dialog.component';
import { FileQuotaStateComponent } from '../file-quota-state/file-quota-state.component';
import { FilesFacade } from '../files.facade';
import { RecentFilesListComponent } from '../recent-files-list/recent-files-list.component';
import { FileViewModel } from '../files.types';

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

  readonly page = this.facade.page;
  readonly syncfusionUploaderEnabled = this.flags.syncfusionUploaderEnabled;
  readonly columns: readonly AppDataGridColumnDef<FileViewModel>[] = [
    { field: 'originalFileName', headerName: 'Name', flex: 2, valueFormatter: ({ value }) => String(value ?? '') },
    { field: 'contentType', headerName: 'Type', flex: 1 },
    { field: 'sizeBytes', headerName: 'Size', valueFormatter: ({ value }) => `${Math.round(Number(value ?? 0) / 1024)} KB` },
    { field: 'scanStatus', headerName: 'Scan' },
    { field: 'createdAtLabel', headerName: 'Created', flex: 1 },
    { headerName: 'Actions', actions: (row) => [{ id: 'download', label: row.downloadState === 'pending' ? 'Authorizing' : 'Download', row, disabled: row.downloadPolicy !== 'available' || row.scanStatus !== 'allowed' || row.downloadState === 'pending', disabledReason: row.downloadMessage }] },
  ];

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

  handleGridAction(event: { actionId: string; row: FileViewModel }): void {
    if (event.actionId === 'download' && event.row.canonicalFileId) { this.downloadFile(event.row.canonicalFileId); }
  }
}
