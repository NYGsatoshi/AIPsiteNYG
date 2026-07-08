import { Component, inject } from '@angular/core';

import { AttachmentPickerDialogComponent } from '../attachment-picker-dialog/attachment-picker-dialog.component';
import { FileQuotaStateComponent } from '../file-quota-state/file-quota-state.component';
import { FilesFacade } from '../files.facade';
import { RecentFilesListComponent } from '../recent-files-list/recent-files-list.component';
import { UploadDropZoneComponent } from '../upload-drop-zone/upload-drop-zone.component';

@Component({
  selector: 'app-files-page',
  standalone: true,
  imports: [AttachmentPickerDialogComponent, FileQuotaStateComponent, RecentFilesListComponent, UploadDropZoneComponent],
  templateUrl: './files-page.component.html',
  styleUrl: './files-page.component.scss'
})
export class FilesPageComponent {
  private readonly facade = inject(FilesFacade);

  readonly page = this.facade.page;

  acceptUpload(file: File): void {
    this.facade.uploadFile(file);
  }

  rejectUpload(fileName: string): void {
    this.facade.rejectOversize(fileName);
  }

  downloadFile(fileObjectId: string): void {
    this.facade.downloadFile(fileObjectId);
  }
}
