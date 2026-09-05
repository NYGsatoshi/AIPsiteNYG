import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager
  selector: 'app-skeleton',
  standalone: true,
  template: `
    <div class="skeleton" aria-hidden="true">
      @for (line of skeletonLines; track line) {
        <span class="skeleton__line" [style.width.%]="line"></span>
      }
    </div>
    <span class="skeleton__label">{{ label }}</span>
  `,
  styles: [
    `
      .skeleton {
        display: grid;
        gap: 0.625rem;
      }

      .skeleton__line {
        display: block;
        height: 0.875rem;
        border-radius: 4px;
        background: linear-gradient(90deg, #e2e8f0 25%, #f8fafc 45%, #e2e8f0 65%);
        background-size: 220% 100%;
        animation: app-skeleton-pulse 1.4s ease-in-out infinite;
      }

      .skeleton__label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      @keyframes app-skeleton-pulse {
        from {
          background-position: 100% 0;
        }
        to {
          background-position: -100% 0;
        }
      }
    `
  ],
})
export class AppSkeletonComponent {
  @Input() lines = 3;
  @Input() label = '読み込み中です。';

  get skeletonLines(): readonly number[] {
    const count = Math.max(1, Math.min(this.lines, 8));
    return Array.from({ length: count }, (_, index) => (index === count - 1 ? 64 : 100));
  }
}
