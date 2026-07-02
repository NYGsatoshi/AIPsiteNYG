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
      state: 'pending',
      selectedFileName: file.name,
      message: 'アップロード待機中です。'
    });
  }

  rejectUpload(fileName: string): void {
    this.uploadOverride.set({
      state: 'tooLarge',
      selectedFileName: fileName,
      message: '100 MBを超えるファイルはアップロードできません。'
    });
  }
}
