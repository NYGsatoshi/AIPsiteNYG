import { Component, computed, inject, signal } from '@angular/core';

import { AttachmentPickerDialogComponent } from '../attachment-picker-dialog/attachment-picker-dialog.component';
import { FileQuotaStateComponent } from '../file-quota-state/file-quota-state.component';
import { FilesFacade } from '../files.facade';
import { FileUploadViewModel } from '../files.types';
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
  private readonly uploadOverride = signal<FileUploadViewModel | null>(null);

  readonly sourcePage = this.facade.page;
  readonly page = computed(() => {
    const page = this.sourcePage();
    return {
      ...page,
      upload: this.uploadOverride() ?? page.upload
    };
  });

  acceptUpload(file: File): void {
    this.uploadOverride.set({
      state: 'failed',
      canUpload: false,
      selectedFileName: file.name,
      message: 'File upload is not available in MVP0.'
    });
  }

  rejectUpload(fileName: string): void {
    this.uploadOverride.set({
      state: 'tooLarge',
      canUpload: false,
      selectedFileName: fileName,
      message:
        '100 MB\u3092\u8d85\u3048\u308b\u30d5\u30a1\u30a4\u30eb\u306f\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u3067\u304d\u307e\u305b\u3093\u3002'
    });
  }
}
