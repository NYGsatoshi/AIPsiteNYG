import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { FileScanStatus } from '../files.types';

@Component({
  selector: 'app-file-scan-status-badge',
  standalone: true,
  template: `
    <span [class]="'scan-badge scan-badge--' + status" data-testid="scan-status-badge">
      {{ i18n.fileScanStatusLabel(status) }}
    </span>
  `,
  styleUrl: './file-scan-status-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class FileScanStatusBadgeComponent {
  readonly i18n = inject(I18nService);

  @Input({ required: true }) status: FileScanStatus = 'pending';
}
