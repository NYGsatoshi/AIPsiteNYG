import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import {
  AIP_AUTH_SESSION_MOCK,
  DEFAULT_AUTH_SESSION
} from '../../core/auth/auth-session.facade';
import { AppShellComponent } from './app-shell.component';

@Component({
  standalone: true,
  template: '<p>準備中</p>'
})
class TestRouteComponent {}

describe('AppShellComponent', () => {
  async function configure(capabilities = DEFAULT_AUTH_SESSION.capabilities): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([
          { path: 'workspaces', component: TestRouteComponent },
          { path: 'projects', component: TestRouteComponent }
        ]),
        {
          provide: AIP_AUTH_SESSION_MOCK,
          useValue: {
            ...DEFAULT_AUTH_SESSION,
            capabilities
          }
        }
      ]
    }).compileComponents();
  }

  it('hides navigation item when capability is absent', async () => {
    await configure(['workspace:view', 'projects:view', 'files:view', 'account:view']);

    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a[href="/projects"]')).toBeTruthy();
    expect(element.querySelector('a[href="/admin/audit"]')).toBeNull();
  });

  it('does not expose hidden routes in mobile navigation', async () => {
    await configure(['workspace:view', 'projects:view']);

    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.componentInstance.openMobileDrawer();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const mobileDrawer = element.querySelector('.app-shell__mobile-drawer');

    expect(mobileDrawer?.querySelector('a[href="/projects"]')).toBeTruthy();
    expect(mobileDrawer?.querySelector('a[href="/admin/audit"]')).toBeNull();
  });

  it('clears page-local search on route change', async () => {
    await configure();

    const fixture = TestBed.createComponent(AppShellComponent);
    const router = TestBed.inject(Router);
    fixture.componentInstance.setPageSearch('abc');

    await router.navigateByUrl('/projects');
    fixture.detectChanges();

    expect(fixture.componentInstance.pageSearch()).toBe('');
  });

  it('renders without backend calls', async () => {
    await configure();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('メニュー');
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
