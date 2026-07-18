import { A11yModule } from '@angular/cdk/a11y';
import {
  AfterViewChecked,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { RealtimeConnectionIndicatorComponent } from '../../core/realtime/realtime-connection-indicator.component';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { RightPanelComponent } from '../../shared/right-panel/right-panel/right-panel.component';
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
    A11yModule,
    FeatureMenuComponent,
    MobileHeaderComponent,
    RealtimeConnectionIndicatorComponent,
    RightPanelComponent,
    RouterOutlet,
    TopBarComponent
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss'
})
export class AppShellComponent implements AfterViewChecked {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly authSession = inject(AuthSessionFacade);
  readonly realtime = inject(RealtimeFacade);
  readonly facade = inject(AppShellFacade);
  private readonly mobileDrawer = viewChild<ElementRef<HTMLElement>>('mobileDrawer');

  readonly viewModel = this.facade.viewModel;
  readonly mobileDrawerOpen = signal(false);
  readonly pageSearch = signal('');
  readonly logoutPending = signal(false);
  readonly logoutError = signal('');
  readonly rightPanelReturnFocus = signal<HTMLElement | null>(null);
  private mobileDrawerReturnFocus: HTMLElement | null = null;
  private mobileDrawerFocused = false;

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.pageSearch.set('');
        this.closeMobileDrawer(false);
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

  logout(): void {
    if (this.logoutPending()) {
      return;
    }

    this.logoutError.set('');
    this.logoutPending.set(true);
    this.authSession.logout().subscribe({
      next: () => {
        this.logoutPending.set(false);
      },
      error: () => {
        this.logoutPending.set(false);
        this.logoutError.set('Logout failed. Try again.');
      }
    });
  }

  toggleMobileDrawer(): void {
    if (this.mobileDrawerOpen()) {
      this.closeMobileDrawer();
      return;
    }

    this.openMobileDrawer();
  }

  openMobileDrawer(): void {
    const activeElement = document.activeElement;
    this.mobileDrawerReturnFocus = activeElement instanceof HTMLElement ? activeElement : null;
    this.mobileDrawerFocused = false;
    this.mobileDrawerOpen.set(true);
  }

  closeMobileDrawer(returnFocus = true): void {
    if (!this.mobileDrawerOpen()) {
      return;
    }

    this.mobileDrawerOpen.set(false);
    this.mobileDrawerFocused = false;

    if (returnFocus) {
      const target = this.mobileDrawerReturnFocus;
      queueMicrotask(() => target?.focus());
    }

    this.mobileDrawerReturnFocus = null;
  }

  toggleRightPanelFromTopBar(trigger: HTMLElement): void {
    this.rightPanelReturnFocus.set(trigger);
    if (this.isTabletOrMobile()) {
      const currentMode = this.viewModel().rightPanelMode;
      this.facade.setRightPanelMode(currentMode === 'drawer' ? 'collapsed' : 'drawer');
      return;
    }

    this.facade.toggleRightPanel();
  }

  ngAfterViewChecked(): void {
    if (!this.mobileDrawerOpen() || this.mobileDrawerFocused) {
      return;
    }

    const drawer = this.mobileDrawer()?.nativeElement;
    const firstFocusable = drawer?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    (firstFocusable ?? drawer)?.focus();
    this.mobileDrawerFocused = true;
  }

  @HostListener('document:keydown.escape', ['$event'])
  closeMobileDrawerFromEscape(event: KeyboardEvent): void {
    if (!this.mobileDrawerOpen()) {
      return;
    }

    event.preventDefault();
    this.closeMobileDrawer();
  }

  private isTabletOrMobile(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;
  }
}
