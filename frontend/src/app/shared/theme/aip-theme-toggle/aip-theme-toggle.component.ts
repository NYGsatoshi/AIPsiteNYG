import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AipThemeService } from '../../../core/theme/aip-theme.service';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-aip-theme-toggle',
  standalone: true,
  template: `
    <button
      type="button"
      class="theme-toggle"
      data-testid="theme-toggle"
      [attr.aria-label]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
      [attr.title]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
      (click)="theme.toggleTheme()"
    >
      <span class="theme-toggle__icon" aria-hidden="true">{{ theme.isDark() ? '☀' : '☾' }}</span>
      <span>{{ theme.isDark() ? 'Light' : 'Dark' }}</span>
    </button>
  `,
  styleUrl: './aip-theme-toggle.component.scss',
})
export class AipThemeToggleComponent {
  readonly theme = inject(AipThemeService);
}
