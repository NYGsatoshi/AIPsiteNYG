import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-mobile-header',
  standalone: true,
  template: `
    <div class="mobile-header" role="region" aria-label="Mobile header">
      <button
        type="button"
        class="mobile-header__menu"
        data-testid="mobile-nav-toggle"
        [attr.aria-expanded]="drawerOpen"
        aria-controls="mobile-navigation"
        aria-label="メニュー"
        (click)="drawerToggle.emit()"
      >
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </button>
      <div class="mobile-header__title">
        <span>{{ workspaceLabel || '場所未選択' }}</span>
      </div>
    </div>
  `,
  styleUrl: './mobile-header.component.scss'
})
export class MobileHeaderComponent {
  @Input() workspaceLabel = '';
  @Input() drawerOpen = false;
  @Output() drawerToggle = new EventEmitter<void>();
}
