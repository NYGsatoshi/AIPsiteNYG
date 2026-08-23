import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import {
  NavigationItem,
  NavigationMoveDirection,
  NavigationMoveRequest
} from '../../shared/navigation/navigation.models';

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

      @if (collapsible && collapsed) {
        <div class="feature-menu__rail" data-testid="feature-menu-rail">
          @for (item of navigationItems; track item.id) {
            <a
              class="feature-menu__item feature-menu__item--rail"
              routerLinkActive="feature-menu__item--active"
              ariaCurrentWhenActive="page"
              [routerLinkActiveOptions]="{ exact: false }"
              [routerLink]="item.route"
              [attr.data-testid]="'nav-' + item.id"
              [title]="item.label"
              (click)="itemSelected.emit()"
            >
              <span class="feature-menu__rail-label" aria-hidden="true">{{ railLabel(item) }}</span>
              <span class="feature-menu__sr-only">{{ item.label }}</span>
            </a>
          }

          @if (pinnedItems.length > 0) {
            <div class="feature-menu__rail-divider" aria-hidden="true"></div>
            @for (item of pinnedItems; track item.id) {
              <a
                class="feature-menu__item feature-menu__item--rail feature-menu__item--pinned"
                routerLinkActive="feature-menu__item--active"
                ariaCurrentWhenActive="page"
                [routerLinkActiveOptions]="{ exact: false }"
                [routerLink]="item.route"
                [attr.data-testid]="'nav-' + item.id"
                [title]="'Pinned: ' + item.label"
                (click)="itemSelected.emit()"
              >
                <span class="feature-menu__rail-label" aria-hidden="true">{{ railLabel(item) }}</span>
                <span class="feature-menu__sr-only">Pinned: {{ item.label }}</span>
              </a>
            }
          }
        </div>
      } @else {
        <section class="feature-menu__section" data-testid="primary-navigation-section" aria-label="Main navigation">
          <h2 class="feature-menu__section-title">Main</h2>
          <div class="feature-menu__items">
            @for (item of navigationItems; track item.id) {
              <a
                class="feature-menu__item"
                routerLinkActive="feature-menu__item--active"
                ariaCurrentWhenActive="page"
                [routerLinkActiveOptions]="{ exact: false }"
                [routerLink]="item.route"
                [attr.data-testid]="'nav-' + item.id"
                (click)="itemSelected.emit()"
              >
                <span class="feature-menu__marker" aria-hidden="true"></span>
                <span>{{ item.label }}</span>
              </a>
            }
          </div>
        </section>

        <section class="feature-menu__section feature-menu__section--pinned" data-testid="pinned-navigation-section" aria-label="Pinned navigation">
          <div class="feature-menu__section-heading">
            <h2 class="feature-menu__section-title">Pinned</h2>
            @if (pinnedItems.length > 0) {
              <button
                type="button"
                class="feature-menu__section-toggle"
                data-testid="pinned-section-toggle"
                [attr.aria-expanded]="!pinnedCollapsed"
                [attr.aria-label]="pinnedCollapsed ? 'Pinnedを展開' : 'Pinnedを折り畳む'"
                (click)="pinnedCollapsedChange.emit(!pinnedCollapsed)"
              >
                {{ pinnedCollapsed ? '表示' : '隠す' }}
              </button>
            }
          </div>

          @if (!pinnedCollapsed) {
            @if (pinnedItems.length === 0) {
              <p class="feature-menu__empty">ピン留めされた項目はありません。</p>
            } @else {
              <div class="feature-menu__items feature-menu__items--pinned">
                @for (item of pinnedItems; track item.id; let index = $index) {
                  <div class="feature-menu__pinned-row">
                    <a
                      class="feature-menu__item feature-menu__item--pinned"
                      routerLinkActive="feature-menu__item--active"
                      ariaCurrentWhenActive="page"
                      [routerLinkActiveOptions]="{ exact: false }"
                      [routerLink]="item.route"
                      [attr.data-testid]="'nav-' + item.id"
                      (click)="itemSelected.emit()"
                    >
                      <span class="feature-menu__marker" aria-hidden="true"></span>
                      <span>{{ item.label }}</span>
                    </a>
                    @if (pinnedItems.length > 1) {
                      <div class="feature-menu__pinned-actions">
                        <button
                          type="button"
                          class="feature-menu__move"
                          [attr.data-testid]="'pinned-move-up-' + item.id"
                          [attr.aria-label]="item.label + 'を上へ移動'"
                          [disabled]="index === 0"
                          (click)="requestPinnedMove(item.id, 'up')"
                        >
                          上へ
                        </button>
                        <button
                          type="button"
                          class="feature-menu__move"
                          [attr.data-testid]="'pinned-move-down-' + item.id"
                          [attr.aria-label]="item.label + 'を下へ移動'"
                          [disabled]="index === pinnedItems.length - 1"
                          (click)="requestPinnedMove(item.id, 'down')"
                        >
                          下へ
                        </button>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          }
        </section>
      }
    </nav>
  `,
  styleUrl: './feature-menu.component.scss'
})
export class FeatureMenuComponent {
  @Input() navigationItems: readonly NavigationItem[] = [];
  @Input() pinnedItems: readonly NavigationItem[] = [];
  @Input() pinnedCollapsed = false;
  @Input() compact = false;
  @Input() collapsible = false;
  @Input() collapsed = false;
  @Input() navigationAriaLabel = 'Primary navigation';
  @Output() itemSelected = new EventEmitter<void>();
  @Output() collapsedChange = new EventEmitter<boolean>();
  @Output() pinnedCollapsedChange = new EventEmitter<boolean>();
  @Output() pinnedMove = new EventEmitter<NavigationMoveRequest>();

  toggleCollapsed(): void {
    if (!this.collapsible) {
      return;
    }

    this.collapsedChange.emit(!this.collapsed);
  }

  requestPinnedMove(itemId: string, direction: NavigationMoveDirection): void {
    this.pinnedMove.emit({ itemId, direction });
  }

  railLabel(item: NavigationItem): string {
    const words = item.label.trim().split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return words.slice(0, 2).map((word) => word.slice(0, 1)).join('').toUpperCase();
    }

    return item.label.slice(0, 2).toUpperCase();
  }
}
