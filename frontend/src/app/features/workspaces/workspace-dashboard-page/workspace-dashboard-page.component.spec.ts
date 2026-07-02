import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AIP_WORKSPACES_DASHBOARD_MOCK } from '../workspaces.facade';
import { DEFAULT_WORKSPACES, LONG_NAME_WORKSPACE, WORKSPACE_DASHBOARD_SCENARIOS } from '../workspaces.mock';
import { WorkspaceDashboardViewModel } from '../workspaces.types';
import { WorkspaceDashboardPageComponent } from './workspace-dashboard-page.component';

const renderDashboard = async (dashboard: WorkspaceDashboardViewModel): Promise<ComponentFixture<WorkspaceDashboardPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [WorkspaceDashboardPageComponent],
    providers: [{ provide: AIP_WORKSPACES_DASHBOARD_MOCK, useValue: dashboard }]
  }).compileComponents();

  const fixture = TestBed.createComponent(WorkspaceDashboardPageComponent);
  fixture.detectChanges();
  return fixture;
};

const textContent = (fixture: ComponentFixture<WorkspaceDashboardPageComponent>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

describe('WorkspaceDashboardPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('hides create action when capability is absent', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      pageCapabilities: []
    });

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="create-workspace-action"]')).toBeNull();
  });

  it('filters only provided mock workspace rows with page-local search', async () => {
    const fixture = await renderDashboard(WORKSPACE_DASHBOARD_SCENARIOS.default);

    fixture.componentInstance.updateSearch('教材準備');
    fixture.detectChanges();

    const text = textContent(fixture);
    expect(text).toContain('教材準備ワークスペースB');
    expect(text).not.toContain('サンプル共同ワークスペースA');

    fixture.componentInstance.updateSearch('未提供の外部ワークスペース');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="workspace-card"]').length).toBe(0);
  });

  it('does not render email addresses', async () => {
    const fixture = await renderDashboard(WORKSPACE_DASHBOARD_SCENARIOS.default);

    expect(textContent(fixture)).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });

  it('does not render DM preview text', async () => {
    const fixture = await renderDashboard(WORKSPACE_DASHBOARD_SCENARIOS.default);

    expect(textContent(fixture)).not.toContain('DM');
    expect(textContent(fixture)).not.toContain('本文プレビュー');
  });

  it('does not expose hidden member action in mobile layout', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      workspaces: [{ ...DEFAULT_WORKSPACES[2], capabilities: ['openWorkspace'] }]
    });

    (fixture.nativeElement as HTMLElement).style.width = '320px';
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="open-members-action"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="open-workspace-action"]')).not.toBeNull();
  });

  it('wraps long workspace names safely', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.longWorkspaceNames,
      workspaces: [LONG_NAME_WORKSPACE]
    });

    const name = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="workspace-name"]');
    expect(name?.textContent).toContain('非常に長い表示名');
    expect(getComputedStyle(name as HTMLElement).overflowWrap).toBe('anywhere');
  });
});
