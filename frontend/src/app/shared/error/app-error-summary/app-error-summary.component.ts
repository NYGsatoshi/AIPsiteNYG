import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { FrontendApiError } from '../../../core/api/api-error.model';
import { AppErrorBannerComponent } from '../app-error-banner/app-error-banner.component';

@Component({
  selector: 'app-error-summary',
  standalone: true,
  imports: [AppErrorBannerComponent],
  template: `
    <div class="error-summary">
      @for (error of errors; track error.localErrorId) {
        <app-error-banner [error]="error" title="入力内容を確認してください" />
      }
    </div>
  `,
  styles: [
    `
      .error-summary {
        display: grid;
        gap: 0.75rem;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.Eager
})
export class AppErrorSummaryComponent {
  @Input() errors: readonly FrontendApiError[] = [];
}
