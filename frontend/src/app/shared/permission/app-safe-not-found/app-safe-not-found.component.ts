import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-safe-not-found',
  standalone: true,
  template: `
    <section class="safe-state" role="status" [attr.aria-labelledby]="titleId">
      <h2 [id]="titleId">{{ title }}</h2>
      <p>対象が見つからないか、表示できません。</p>
    </section>
  `,
  styles: [
    `
      .safe-state {
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        background: #eff6ff;
        padding: 1rem;
        color: #1e3a8a;
      }

      h2,
      p {
        margin: 0;
      }

      h2 {
        margin-bottom: 0.5rem;
        font-size: 1rem;
      }
    `
  ],
})
export class AppSafeNotFoundComponent {
  @Input() title = '表示できません';
  @Input() titleId = 'app-safe-not-found-title';
}
