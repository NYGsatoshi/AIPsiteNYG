import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';

import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-mobile-header',
  standalone: true,
  template: `
    <div class="mobile-header" role="region" [attr.aria-label]="i18n.translate('shell.mobileControls')">
      <button
        type="button"
        class="mobile-header__menu"
        data-testid="mobile-nav-toggle"
        [attr.aria-expanded]="drawerOpen"
        aria-controls="mobile-navigation"
        [attr.aria-label]="drawerOpen ? i18n.translate('shell.closeNavigation') : i18n.translate('shell.openNavigation')"
        (click)="drawerToggle.emit()"
      >
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </button>
      <div class="mobile-header__title">
        <span>{{ workspaceLabel || i18n.translate('shell.workspaceNotSelected') }}</span>
      </div>
    </div>
  `,
  styleUrl: './mobile-header.component.scss',
})
export class MobileHeaderComponent {
  readonly i18n = inject(I18nService);
  @Input() workspaceLabel = '';
  @Input() drawerOpen = false;
  @Output() drawerToggle = new EventEmitter<void>();
}
