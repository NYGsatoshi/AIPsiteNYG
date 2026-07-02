import { Component, Input } from '@angular/core';

import { FILE_SCAN_STATUS_LABELS, FileScanStatus } from '../files.types';

@Component({
  selector: 'app-file-scan-status-badge',
  standalone: true,
  template: `
    <span class="scan-badge" [class]="'scan-badge scan-badge--' + status" data-testid="scan-status-badge">
      {{ labels[status] }}
    </span>
  `,
  styleUrl: './file-scan-status-badge.component.scss'
})
export class FileScanStatusBadgeComponent {
  @Input({ required: true }) status: FileScanStatus = 'pending';

  readonly labels = FILE_SCAN_STATUS_LABELS;
}
