import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-permission-denied',
  standalone: true,
  template: `
    <section
      class="safe-state"
      data-testid="permission-denied-state"
      role="status"
      [attr.aria-labelledby]="titleId"
    >
      <h2 [id]="titleId">{{ title }}</h2>
      <p>この操作を実行する権限がありません。</p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .safe-state {
        border: 1px solid var(--aip-color-warning);
        border-radius: var(--aip-radius-lg);
        background: var(--aip-color-bg-surface-subtle);
        padding: 1rem;
        color: var(--aip-color-text-primary);
      }

      h2,
      p {
        margin: 0;
      }

      h2 {
        margin-bottom: 0.5rem;
        font-size: 1rem;
      }
    `,
  ],
})
export class AppPermissionDeniedComponent {
  @Input() title = 'アクセスできません';
  @Input() titleId = 'app-permission-denied-title';
}
