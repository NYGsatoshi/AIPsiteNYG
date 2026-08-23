import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AIP_WORKSPACES_DASHBOARD_MOCK } from '../workspaces.facade';
import {
  DEFAULT_WORKSPACES,
  LONG_NAME_WORKSPACE,
  OWNER_WORKSPACE,
  READ_ONLY_WORKSPACE,
  SYSTEM_ADMIN_WORKSPACE,
  WORKSPACE_DASHBOARD_SCENARIOS,
} from '../workspaces.mock';
import { WorkspaceDashboardViewModel } from '../workspaces.types';
import { WorkspaceDashboardPageComponent } from './workspace-dashboard-page.component';

const renderDashboard = async (
  dashboard: WorkspaceDashboardViewModel,
): Promise<ComponentFixture<WorkspaceDashboardPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [WorkspaceDashboardPageComponent],
    providers: [provideRouter([]), { provide: AIP_WORKSPACES_DASHBOARD_MOCK, useValue: dashboard }],
  }).compileComponents();

  const fixture = TestBed.createComponent(WorkspaceDashboardPageComponent);
  fixture.detectChanges();
  return fixture;
};

const textContent = (fixture: ComponentFixture<WorkspaceDashboardPageComponent>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

const workspaceCard = (
  fixture: ComponentFixture<WorkspaceDashboardPageComponent>,
  workspaceName: string,
): HTMLElement => {
  const cards = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '[data-testid="workspace-card"]',
    ),
  );
  const card = cards.find((candidate) => candidate.textContent?.includes(workspaceName));
  if (!card) {
    throw new Error(`Workspace card '${workspaceName}' was not rendered.`);
  }
  return card;
};

describe('WorkspaceDashboardPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('hides create action when capability is absent', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      pageCapabilities: [],
    });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="create-workspace-action"]',
      ),
    ).toBeNull();
  });

  it('shows create action only when the page capability is present', async () => {
    const fixture = await renderDashboard(WORKSPACE_DASHBOARD_SCENARIOS.default);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="create-workspace-action"]',
      ),
    ).not.toBeNull();
  });

  it('renders one primary research action and a separate file action for an authorized Workspace', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      workspaces: [OWNER_WORKSPACE],
    });

    const card = workspaceCard(fixture, OWNER_WORKSPACE.displayName);
    const primaryActions = card.querySelectorAll('[data-testid="start-research-action"]');
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0]?.textContent?.trim()).toBe('新しいリサーチ');
    expect(primaryActions[0]?.getAttribute('href')).toBe(
      '/workspaces/sample-workspace-owner/research/new',
    );

    const addFiles = card.querySelector<HTMLAnchorElement>('[data-testid="add-files-action"]');
    expect(addFiles?.textContent?.trim()).toBe('ファイルを追加');
    expect(addFiles?.getAttribute('href')).toBe('/workspaces/sample-workspace-owner/files#upload');
  });

  it('does not infer create actions from Workspace read access', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      workspaces: [{ ...DEFAULT_WORKSPACES[2], capabilities: ['openWorkspace'] }],
    });

    const card = workspaceCard(fixture, DEFAULT_WORKSPACES[2].displayName);
    expect(card.querySelector('[data-testid="start-research-action"]')).toBeNull();
    expect(card.querySelector('[data-testid="add-files-action"]')).toBeNull();
    expect(card.querySelector('[data-testid="open-members-action"]')).toBeNull();
    expect(card.querySelector('[data-testid="open-projects-action"]')).toBeNull();
  });

  it('keeps lower-frequency navigation distinct from create actions', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      workspaces: [OWNER_WORKSPACE],
    });

    const card = workspaceCard(fixture, OWNER_WORKSPACE.displayName);
    expect(card.querySelector('[data-testid="open-projects-action"]')?.textContent?.trim()).toBe(
      'プロジェクト',
    );
    expect(card.querySelector('[data-testid="open-members-action"]')?.textContent?.trim()).toBe(
      'メンバー',
    );
    expect(card.querySelectorAll('[data-testid="start-research-action"]')).toHaveLength(1);
  });

  it('filters only provided mock workspace rows with page-local search', async () => {
    const fixture = await renderDashboard(WORKSPACE_DASHBOARD_SCENARIOS.default);

    fixture.componentInstance.updateSearch('教材準備');
    fixture.detectChanges();

    const text = textContent(fixture);
    expect(text).toContain('教材準備ワークスペースC');
    expect(text).not.toContain('サンプル共同ワークスペースA');

    fixture.componentInstance.updateSearch('未提供の外部ワークスペース');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="workspace-card"]')
        .length,
    ).toBe(0);
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

  it('does not render an action denied by the corresponding backend capability', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      workspaces: [READ_ONLY_WORKSPACE],
    });

    const card = workspaceCard(fixture, READ_ONLY_WORKSPACE.displayName);
    expect(card.querySelector('[data-testid="start-research-action"]')).toBeNull();
    expect(card.querySelector('[data-testid="add-files-action"]')).toBeNull();
    expect(card.querySelector('[data-testid="open-members-action"]')).toBeNull();
    expect(card.querySelector('[data-testid="open-projects-action"]')).toBeNull();
  });

  it('renders zero and non-zero authoritative counts as text', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      workspaces: [OWNER_WORKSPACE, READ_ONLY_WORKSPACE],
    });

    const ownerCard = workspaceCard(fixture, OWNER_WORKSPACE.displayName);
    expect(
      ownerCard.querySelector('[data-testid="unread-announcement-count"]')?.textContent?.trim(),
    ).toBe('3');
    expect(
      ownerCard.querySelector('[data-testid="unread-conversation-count"]')?.textContent?.trim(),
    ).toBe('2');
    expect(
      ownerCard.querySelector('[data-testid="active-project-count"]')?.textContent?.trim(),
    ).toBe('5');

    const readOnlyCard = workspaceCard(fixture, READ_ONLY_WORKSPACE.displayName);
    expect(
      readOnlyCard.querySelector('[data-testid="unread-announcement-count"]')?.textContent?.trim(),
    ).toBe('0');
    expect(
      readOnlyCard.querySelector('[data-testid="unread-conversation-count"]')?.textContent?.trim(),
    ).toBe('0');
    expect(
      readOnlyCard.querySelector('[data-testid="active-project-count"]')?.textContent?.trim(),
    ).toBe('0');
  });

  it('keeps an unavailable count visibly distinct from numeric zero', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.default,
      workspaces: [
        READ_ONLY_WORKSPACE,
        {
          ...READ_ONLY_WORKSPACE,
          id: 'unavailable-workspace',
          displayName: '集計取得不可ワークスペース',
          unreadAnnouncementCount: null,
          availability: {
            ...READ_ONLY_WORKSPACE.availability,
            unreadAnnouncements: false,
          },
        },
      ],
    });

    const zeroCard = workspaceCard(fixture, READ_ONLY_WORKSPACE.displayName);
    expect(
      zeroCard.querySelector('[data-testid="unread-announcement-count"]')?.textContent?.trim(),
    ).toBe('0');

    const unavailableCard = workspaceCard(fixture, '集計取得不可ワークスペース');
    expect(
      unavailableCard
        .querySelector('[data-testid="unread-announcement-count"]')
        ?.textContent?.trim(),
    ).toBe('未提供');
  });

  it('presents SystemAdmin access without inventing a Workspace membership role or Project-create authority', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.systemAdmin,
      workspaces: [SYSTEM_ADMIN_WORKSPACE],
    });

    const card = workspaceCard(fixture, SYSTEM_ADMIN_WORKSPACE.displayName);
    const role = card.querySelector('[data-testid="workspace-role"]')?.textContent?.trim();
    expect(role).toBe('システム管理者アクセス');
    expect(role).not.toBe('メンバー');
    expect(card.querySelector('[data-testid="start-research-action"]')).toBeNull();
    expect(card.querySelector('[data-testid="add-files-action"]')).not.toBeNull();
  });

  it('does not show the obsolete API-unimplemented summary message for a complete projection', async () => {
    const fixture = await renderDashboard(WORKSPACE_DASHBOARD_SCENARIOS.default);

    expect(textContent(fixture)).not.toContain('一部の集計情報はまだAPI未実装です。');
    expect(textContent(fixture)).not.toContain('API未実装');
  });

  it.each([
    ['error', WORKSPACE_DASHBOARD_SCENARIOS.error],
    ['permission denied', WORKSPACE_DASHBOARD_SCENARIOS.permissionDenied],
    ['no Workspace access', WORKSPACE_DASHBOARD_SCENARIOS.noWorkspaceAccess],
  ])('keeps the %s state free of stale Workspace cards', async (_label, dashboard) => {
    const fixture = await renderDashboard(dashboard);

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="workspace-card"]'),
    ).toHaveLength(0);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="create-workspace-action"]',
      ),
    ).toBeNull();
    expect(textContent(fixture)).toContain(dashboard.message ?? '');
  });

  it('wraps long workspace names safely', async () => {
    const fixture = await renderDashboard({
      ...WORKSPACE_DASHBOARD_SCENARIOS.longWorkspaceNames,
      workspaces: [LONG_NAME_WORKSPACE],
    });

    const name = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="workspace-name"]',
    );
    expect(name?.textContent).toContain('非常に長い表示名');
    expect(getComputedStyle(name as HTMLElement).overflowWrap).toBe('anywhere');
  });
});