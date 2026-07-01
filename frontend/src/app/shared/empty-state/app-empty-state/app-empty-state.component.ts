import { Component, EventEmitter, Input, Output } from '@angular/core';

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
        gap: 0.75rem;
        border: 1px dashed #cbd5e1;
        border-radius: 8px;
        background: #f8fafc;
        padding: 1.25rem;
        color: #334155;
      }

      h2,
      p {
        margin: 0;
      }

      h2 {
        font-size: 1rem;
      }

      button {
        border: 1px solid #2563eb;
        border-radius: 6px;
        background: #2563eb;
        padding: 0.5rem 0.75rem;
        color: white;
        font-weight: 700;
      }
    `
  ]
})
export class AppEmptyStateComponent {
  @Input() title = '表示する項目がありません。';
  @Input() message = '条件を変更するか、後でもう一度確認してください。';
  @Input() titleId = 'app-empty-state-title';
  @Input() actionLabel = '';
  @Output() action = new EventEmitter<void>();
}
