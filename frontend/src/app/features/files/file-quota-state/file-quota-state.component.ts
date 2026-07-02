import { Component, Input } from '@angular/core';

import { FileQuotaViewModel } from '../files.types';

@Component({
  selector: 'app-file-quota-state',
  standalone: true,
  template: `
    <section class="quota" [class]="'quota quota--' + quota.state" data-testid="file-quota-state">
      <div>
        <p>容量</p>
        <strong>{{ quota.message }}</strong>
      </div>
      <span>{{ formatBytes(quota.usedBytes) }} / {{ formatBytes(quota.limitBytes) }}</span>
    </section>
  `,
  styleUrl: './file-quota-state.component.scss'
})
export class FileQuotaStateComponent {
  @Input({ required: true }) quota!: FileQuotaViewModel;

  formatBytes(bytes: number): string {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }
}
