import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-inline-loading',
  standalone: true,
  template: `
    <span class="inline-loading" role="status" aria-live="polite">
      <span class="inline-loading__spinner" aria-hidden="true"></span>
      <span>{{ label }}</span>
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .inline-loading {
        display: inline-flex;
        gap: 0.5rem;
        align-items: center;
        color: var(--aip-color-text-secondary);
        font-size: 0.925rem;
      }

      .inline-loading__spinner {
        width: 1rem;
        height: 1rem;
        border: 2px solid var(--aip-color-border-default);
        border-top-color: var(--aip-color-action-primary);
        border-radius: var(--aip-radius-pill);
        animation: app-inline-loading-spin 0.8s linear infinite;
      }

      @keyframes app-inline-loading-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class AppInlineLoadingComponent {
  @Input() label = '読み込み中です。';
}
