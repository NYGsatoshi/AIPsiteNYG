import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { NavigationItem } from '../../shared/navigation/navigation.models';

@Component({
  selector: 'app-feature-menu',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav
      class="feature-menu"
      [class.feature-menu--compact]="compact"
      [class.feature-menu--collapsible]="collapsible"
      [class.feature-menu--collapsed]="collapsible && collapsed"
      [attr.aria-label]="navigationAriaLabel"
    >
      <div class="feature-menu__heading">
        @if (!collapsible || !collapsed) {
          <span>メニュー</span>
        }
        @if (collapsible) {
          <button
            type="button"
            class="feature-menu__toggle"
            data-testid="feature-menu-toggle"
            [attr.aria-expanded]="!collapsed"
            [attr.aria-label]="collapsed ? 'メニューを展開' : 'メニューを折り畳む'"
            [title]="collapsed ? 'メニューを展開' : 'メニューを折り畳む'"
            (click)="toggleCollapsed()"
          >
            <span aria-hidden="true">{{ collapsed ? '›' : '‹' }}</span>
          </button>
        }
      </div>

      @if (!collapsible || !collapsed) {
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
      }
    </nav>
  `,
  styleUrl: './feature-menu.component.scss'
})
export class FeatureMenuComponent {
  @Input() navigationItems: readonly NavigationItem[] = [];
  @Input() compact = false;
  @Input() collapsible = false;
  @Input() collapsed = false;
  @Input() navigationAriaLabel = 'Primary navigation';
  @Output() itemSelected = new EventEmitter<void>();
  @Output() collapsedChange = new EventEmitter<boolean>();

  toggleCollapsed(): void {
    if (!this.collapsible) {
      return;
    }

    this.collapsedChange.emit(!this.collapsed);
  }
}
