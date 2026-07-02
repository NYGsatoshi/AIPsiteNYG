import { Component, Input, signal } from '@angular/core';

import { FileScanStatusBadgeComponent } from '../file-scan-status-badge/file-scan-status-badge.component';
import { FileViewModel } from '../files.types';

@Component({
  selector: 'app-attachment-picker-dialog',
  standalone: true,
  imports: [FileScanStatusBadgeComponent],
  templateUrl: './attachment-picker-dialog.component.html',
  styleUrl: './attachment-picker-dialog.component.scss'
})
export class AttachmentPickerDialogComponent {
  @Input({ required: true }) files: readonly FileViewModel[] = [];

  readonly selectedCanonicalFileIds = signal<readonly string[]>([]);

  toggleFile(file: FileViewModel, checked: boolean): void {
    if (!file.canonicalFileId) {
      return;
    }

    const current = this.selectedCanonicalFileIds();
    if (checked) {
      this.selectedCanonicalFileIds.set([...new Set([...current, file.canonicalFileId])]);
      return;
    }

    this.selectedCanonicalFileIds.set(current.filter((fileId) => fileId !== file.canonicalFileId));
  }
}
