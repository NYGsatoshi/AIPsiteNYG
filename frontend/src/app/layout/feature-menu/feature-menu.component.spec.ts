import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NavigationItem } from '../../shared/navigation/navigation.models';
import { FeatureMenuComponent } from './feature-menu.component';

const navigationItems: readonly NavigationItem[] = [
  { id: 'projects', label: 'Projects', route: '/projects' },
  { id: 'tasks', label: 'Tasks', route: '/tasks' },
];

describe('FeatureMenuComponent', () => {
  async function createFeatureMenu(collapsed = false) {
    await TestBed.configureTestingModule({
      imports: [FeatureMenuComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(FeatureMenuComponent);
    fixture.componentRef.setInput('navigationItems', navigationItems);
    fixture.componentRef.setInput('collapsible', true);
    fixture.componentRef.setInput('collapsed', collapsed);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('emits a collapse request from the desktop menu toggle', async () => {
    const fixture = await createFeatureMenu(false);
    let requestedState: boolean | undefined;
    fixture.componentInstance.collapsedChange.subscribe((value) => {
      requestedState = value;
    });

    const element = fixture.nativeElement as HTMLElement;
    const menu = element.querySelector<HTMLElement>('.feature-menu');
    const toggle = element.querySelector<HTMLButtonElement>('[data-testid="feature-menu-toggle"]');

    expect(menu?.classList.contains('feature-menu--collapsible')).toBe(true);
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('[data-testid="nav-projects"]')).toBeTruthy();

    toggle?.click();

    expect(requestedState).toBe(true);
  });

  it('keeps a labelled reopen control while collapsed and hides navigation links', async () => {
    const fixture = await createFeatureMenu(true);
    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('[data-testid="feature-menu-toggle"]');

    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe('メニューを展開');
    expect(element.querySelector('[data-testid="nav-projects"]')).toBeNull();
    expect(element.querySelector('[data-testid="nav-tasks"]')).toBeNull();
  });

  it('does not add desktop collapse layout or controls to the compact mobile menu', async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureMenuComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(FeatureMenuComponent);
    fixture.componentRef.setInput('navigationItems', navigationItems);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const menu = element.querySelector<HTMLElement>('.feature-menu');

    expect(menu?.classList.contains('feature-menu--compact')).toBe(true);
    expect(menu?.classList.contains('feature-menu--collapsible')).toBe(false);
    expect(menu?.classList.contains('feature-menu--collapsed')).toBe(false);
    expect(element.querySelector('[data-testid="feature-menu-toggle"]')).toBeNull();
    expect(element.querySelector('[data-testid="nav-projects"]')).toBeTruthy();
  });
});
