import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TopBarComponent } from './top-bar.component';

describe('TopBarComponent', () => {
  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [TopBarComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const fixture = TestBed.createComponent(TopBarComponent);
    fixture.componentRef.setInput('workspace', { id: 'workspace-a', label: 'Workspace Alpha' });
    fixture.componentRef.setInput('workspaceOptions', [
      { id: 'workspace-a', label: 'Workspace Alpha' },
      { id: 'workspace-b', label: 'Workspace Beta' }
    ]);
    fixture.componentRef.setInput('workspaceSelectionStatus', 'selected');
    fixture.componentRef.setInput('runningProjectCount', 2);
    fixture.componentRef.setInput('needsReviewProjectCount', 1);
    fixture.componentRef.setInput('canOpenWorkspaceMembers', true);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('separates Workspace context/actions from global actions and exposes textual Research state', async () => {
    const fixture = await createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('nav[aria-label="Workspace actions"]')?.textContent).toContain('Members');
    expect(element.querySelector('nav[aria-label="Global actions"]')?.textContent).toContain('Notifications');
    expect(element.querySelector('nav[aria-label="Global actions"]')?.textContent).toContain('Account');
    expect(element.querySelector('[data-testid="workspace-research-status"]')?.textContent).toContain('2 Running');
    expect(element.querySelector('[data-testid="workspace-research-status"]')?.textContent).toContain('1 Needs review');
    expect(element.querySelector('[data-testid="workspace-search-input"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="page-search"]')).toBeNull();
  });

  it('emits an explicit authorized Workspace selection only when it changes', async () => {
    const fixture = await createComponent();
    const selected: string[] = [];
    fixture.componentInstance.workspaceSelected.subscribe((workspaceId) => selected.push(workspaceId));
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '[data-testid="workspace-switcher"]'
    )!;

    select.value = 'workspace-b';
    select.dispatchEvent(new Event('change'));
    select.value = 'workspace-a';
    select.dispatchEvent(new Event('change'));

    expect(selected).toEqual(['workspace-b']);
  });

  it('distinguishes authoritative zero counts from unavailable Research state', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput('runningProjectCount', 0);
    fixture.componentRef.setInput('needsReviewProjectCount', 0);
    fixture.detectChanges();

    const status = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="workspace-research-status"]'
    );
    expect(status?.textContent).toContain('0 Running');
    expect(status?.textContent).toContain('0 Needs review');

    fixture.componentRef.setInput('runningProjectCount', null);
    fixture.detectChanges();
    expect(status?.textContent).toContain('Status unavailable');
  });

  it('fails closed when selection data or member capability is unavailable', async () => {
    const fixture = await createComponent();
    fixture.componentRef.setInput('workspaceSelectionStatus', 'unavailable');
    fixture.componentRef.setInput('canOpenWorkspaceMembers', false);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLSelectElement>('[data-testid="workspace-switcher"]')?.disabled).toBe(true);
    expect(element.querySelector('[data-testid="workspace-members-action"]')).toBeNull();
    expect(element.querySelector('[data-testid="account-action"]')?.getAttribute('href')).toBe('/account');
    expect(element.querySelector('[data-testid="logout-action"]')).not.toBeNull();
  });
});
