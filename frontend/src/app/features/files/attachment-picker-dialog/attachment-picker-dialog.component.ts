import { Component, EventEmitter, Input, Output } from '@angular/core';

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
  @Input() selectedAttachmentId: string | null = null;
  @Input() disabled = true;
  @Input() disabledMessage = 'Attachment picker is not available in MVP0.';

  @Output() selectionChange = new EventEmitter<string | null>();

  toggleFile(file: FileViewModel, checked: boolean): void {
    if (this.disabled || !file.id || file.scanStatus !== 'allowed') {
      return;
    }

    this.selectionChange.emit(checked ? file.id : null);
  }
}
