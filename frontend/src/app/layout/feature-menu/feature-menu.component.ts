import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { NavigationItem } from '../../shared/navigation/navigation.models';

@Component({
  selector: 'app-feature-menu',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="feature-menu" [class.feature-menu--compact]="compact" [attr.aria-label]="navigationAriaLabel">
      <div class="feature-menu__heading">
        <span>メニュー</span>
      </div>
      @for (item of navigationItems; track item.id) {
        <a
          class="feature-menu__item"
          routerLinkActive="feature-menu__item--active"
          [routerLinkActiveOptions]="{ exact: true }"
          [routerLink]="item.route"
          [attr.data-testid]="'nav-' + item.id"
          (click)="itemSelected.emit()"
        >
          <span class="feature-menu__marker" aria-hidden="true"></span>
          <span>{{ item.label }}</span>
        </a>
      }
    </nav>
  `,
  styleUrl: './feature-menu.component.scss'
})
export class FeatureMenuComponent {
  @Input() navigationItems: readonly NavigationItem[] = [];
  @Input() compact = false;
  @Input() navigationAriaLabel = 'Primary navigation';
  @Output() itemSelected = new EventEmitter<void>();
}
