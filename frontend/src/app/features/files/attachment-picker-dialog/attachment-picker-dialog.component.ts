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
  @Input() disabled = true;
  @Input() disabledMessage = 'Attachment picker is not available in MVP0.';

  readonly selectedCanonicalFileIds = signal<readonly string[]>([]);

  toggleFile(file: FileViewModel, checked: boolean): void {
    if (this.disabled || !file.canonicalFileId) {
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
