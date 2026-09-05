import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-preview-disabled',
  standalone: true,
  template: `
    <section class="preview-disabled" role="status" [attr.aria-label]="label">
      <strong>{{ title }}</strong>
      <span>{{ message }}</span>
    </section>
  `,
  styles: [
    `
      .preview-disabled {
        display: grid;
        gap: 0.35rem;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #f8fafc;
        padding: 1rem;
        color: #475569;
      }

      strong {
        color: #334155;
      }
    `
  ],
})
export class AppPreviewDisabledComponent {
  @Input() title = 'プレビューは無効です';
  @Input() message = 'この画面では内容のプレビューを表示できません。';
  @Input() label = 'プレビューは無効です';
}
