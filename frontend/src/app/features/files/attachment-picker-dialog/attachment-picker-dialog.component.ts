import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

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
  @Output() selectionChange = new EventEmitter<readonly string[]>();

  toggleFile(file: FileViewModel, checked: boolean): void {
    if (this.disabled || !file.id || file.scanStatus !== 'allowed') {
      return;
    }

    const current = this.selectedCanonicalFileIds();
    if (checked) {
      const next = [...new Set([...current, file.id])]; this.selectedCanonicalFileIds.set(next); this.selectionChange.emit(next);
      return;
    }

    const next = current.filter((fileId) => fileId !== file.id); this.selectedCanonicalFileIds.set(next); this.selectionChange.emit(next);
  }
}
