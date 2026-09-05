import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  template: `
    <section class="empty-state" [attr.aria-labelledby]="titleId">
      <h2 [id]="titleId">{{ title }}</h2>
      <p>{{ message }}</p>
      @if (actionLabel) {
        <button type="button" (click)="action.emit()">{{ actionLabel }}</button>
      }
    </section>
  `,
  styles: [
    `
      .empty-state {
        display: grid;
        justify-items: start;
        gap: var(--aip-component-gap);
        border: 1px dashed var(--aip-color-border-default);
        border-radius: var(--aip-radius-lg);
        background: var(--aip-color-bg-surface-subtle);
        padding: var(--aip-space-5);
        color: var(--aip-color-text-secondary);
      }

      h2,
      p {
        margin: 0;
      }

      h2 {
        font-size: 1rem;
      }

      button {
        min-height: var(--aip-touch-target);
        border: 1px solid var(--aip-color-action-primary);
        border-radius: var(--aip-radius-md);
        background: var(--aip-color-action-primary);
        padding: var(--aip-space-2) var(--aip-space-3);
        color: var(--aip-color-text-inverse);
        font-weight: 700;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.Eager
})
export class AppEmptyStateComponent {
  @Input() title = '表示する項目がありません。';
  @Input() message = '条件を変更するか、後でもう一度確認してください。';
  @Input() titleId = 'app-empty-state-title';
  @Input() actionLabel = '';
  @Output() action = new EventEmitter<void>();
}
