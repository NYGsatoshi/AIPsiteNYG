import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { RightPanelComponent } from '../../shared/right-panel/right-panel.component';
import { AccountRailComponent } from '../account-rail/account-rail.component';
import { FeatureMenuComponent } from '../feature-menu/feature-menu.component';
import { MobileHeaderComponent } from '../mobile-header/mobile-header.component';
import { TopBarComponent } from '../top-bar/top-bar.component';
import { AppShellFacade } from './app-shell.facade';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    AccountRailComponent,
    FeatureMenuComponent,
    MobileHeaderComponent,
    RightPanelComponent,
    RouterOutlet,
    TopBarComponent
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss'
})
export class AppShellComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly facade = inject(AppShellFacade);

  readonly viewModel = this.facade.viewModel;
  readonly mobileDrawerOpen = signal(false);
  readonly pageSearch = signal('');

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.pageSearch.set('');
        this.mobileDrawerOpen.set(false);
      });

    effect(() => {
      if (this.viewModel().session.status === 'expired') {
        this.pageSearch.set('');
      }
    });
  }

  setPageSearch(value: string): void {
    this.pageSearch.set(value);
  }

  toggleMobileDrawer(): void {
    this.mobileDrawerOpen.update((open) => !open);
  }

  openMobileDrawer(): void {
    this.mobileDrawerOpen.set(true);
  }

  closeMobileDrawer(): void {
    this.mobileDrawerOpen.set(false);
  }
}
