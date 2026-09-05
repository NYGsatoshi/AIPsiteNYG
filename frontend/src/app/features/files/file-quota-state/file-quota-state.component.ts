import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { FileQuotaViewModel } from '../files.types';

@Component({
  selector: 'app-file-quota-state',
  standalone: true,
  template: `
    <section [class]="'quota quota--' + quota.state" data-testid="file-quota-state">
      <div>
        <p>{{ i18n.translate('files.quota.title') }}</p>
        <strong>{{ quota.message }}</strong>
      </div>
      <span>{{ formatBytes(quota.usedBytes) }} / {{ formatBytes(quota.limitBytes) }}</span>
    </section>
  `,
  styleUrl: './file-quota-state.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class FileQuotaStateComponent {
  readonly i18n = inject(I18nService);

  @Input({ required: true }) quota!: FileQuotaViewModel;

  formatBytes(bytes: number): string {
    return `${this.i18n.formatNumber(Math.max(0, Math.round(bytes / 1024 / 1024)))} MB`;
  }
}
