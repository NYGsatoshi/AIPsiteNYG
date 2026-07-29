import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

const coreResponsiveRoutes = [
  '/app/workspaces',
  '/app/workspaces/static-workspace-1/members',
  '/app/announcements',
  '/app/workspaces/static-workspace-1/channels/static-conversation-main',
  '/app/dm/static-dm-1',
  '/app/files',
  '/app/projects',
  '/app/tasks',
  '/app/admin/audit',
  '/app/admin/export-diagnostics',
  '/app/account',
  '/app/register/invite'
];

const themeStorageKey = 'aipsite.ui.theme.v1';

const approvedThemeMigrationDiffRatio = {
  desktop: 0.055,
  mobile: 0.002
} as const;

test.describe('MVP-A P0 Angular frontend smoke', () => {
  test('serves the built Angular shell', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('shell-body')).toBeVisible();
    await expect(page.getByTestId('top-bar-region')).toBeVisible();
    await expect(page.locator('router-outlet').first()).toBeAttached();
    await expect(page.locator('app-shell router-outlet')).toBeAttached();

    await expectHealthyAngularPage(page);
    await expectNoAccessibilityViolations(page);
  });

  test('renders the Angular login/session placeholder route', async ({ page }) => {
    await page.goto('/app/login');

    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.getByTestId('page-placeholder')).toBeVisible();
    await expect(page.getByTestId('page-placeholder')).toHaveAttribute('data-tone', 'public');
    await expect(page.locator('app-shell')).toHaveCount(0);
    await expectHealthyAngularPage(page);
  });

  test('renders the workspace route in the Angular shell', async ({ page }) => {
    await page.goto('/app/workspaces');

    await waitForWorkspaceShellReady(page);
    await expect(page.locator('a[href="/app/workspaces"]').first()).toBeAttached();
    await expectHealthyAngularPage(page);
  });

  test('switches and persists the selected light or dark theme', async ({ page }) => {
    await page.addInitScript((storageKey) => {
      if (!globalThis.localStorage.getItem(storageKey)) {
        globalThis.localStorage.setItem(storageKey, 'light');
      }
    }, themeStorageKey);

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page);

    const root = page.locator('html');
    const toggle = page.getByTestId('theme-toggle');
    await expect(root).toHaveAttribute('data-aip-theme', 'light');
    await expect(toggle).toHaveAccessibleName('Switch to dark mode');

    await toggle.click();
    await expect(root).toHaveAttribute('data-aip-theme', 'dark');
    await expect(toggle).toHaveAccessibleName('Switch to light mode');
    await expect
      .poll(() => page.evaluate((storageKey) => globalThis.localStorage.getItem(storageKey), themeStorageKey))
      .toBe('dark');

    await page.reload();
    await waitForWorkspaceShellReady(page);
    await expect(root).toHaveAttribute('data-aip-theme', 'dark');
    await expect(page.getByTestId('theme-toggle')).toHaveAccessibleName('Switch to light mode');
  });

  test('falls back to Angular index.html for unknown user-facing routes', async ({ page, request }) => {
    const response = await request.get('/app/not-a-real-angular-route');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    await expect(response.text()).resolves.toContain('<app-root');

    await page.goto('/app/not-a-real-angular-route');
    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.getByTestId('page-placeholder')).toBeVisible();
    await expectHealthyAngularPage(page);
  });

  test('redirects unauthenticated private route access to login', async ({ page }) => {
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Unauthorized' })
      });
    });

    await page.goto('/app/workspaces');

    await expect(page).toHaveURL(/\/app\/login$/);
    await expect(page.getByTestId('page-placeholder')).toBeVisible();
    await expect(page.locator('app-shell')).toHaveCount(0);
    await expectHealthyAngularPage(page);
  });

  test('keeps API paths out of Angular fallback routing', async ({ request }) => {
    const response = await request.get('/api/playwright-angular-smoke');

    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Endpoint not found.' });

    const body = await response.text();
    expect(body).not.toContain('<app-root');
    expect(body).not.toContain('<!doctype html>');
  });

  test('renders the mobile shell drawer without legacy route exposure', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/workspaces');

    await waitForWorkspaceShellReady(page, { mobile: true });
    await expect(page.getByTestId('account-rail')).toBeHidden();

    const mobileNavigation = page.getByTestId('mobile-navigation');
    const toggle = page.getByTestId('mobile-nav-toggle');
    await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'true');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'false');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(mobileNavigation.locator('a[href="/app/workspaces"]')).toBeVisible();

    for (const legacyRoute of ['/dashboard', '/messages', '/tenant-admin', '/platform-admin']) {
      await expect(page.locator(`a[href="${legacyRoute}"]`)).toHaveCount(0);
    }

    await expectHealthyAngularPage(page);
  });

  test('mobile navigation traps focus and returns focus on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/app/workspaces');

    await waitForWorkspaceShellReady(page, { mobile: true });
    const toggle = page.getByTestId('mobile-nav-toggle');
    await toggle.click();

    const mobileNavigation = page.getByTestId('mobile-navigation');
    await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'false');
    await expect(mobileNavigation).toContainText(/.+/);
    await expect(mobileNavigation.locator('a[href="/app/workspaces"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'true');
    await expect(toggle).toBeFocused();
  });

  test('right panel opens as a drawer on mobile and returns focus when closed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/workspaces');

    await waitForWorkspaceShellReady(page, { mobile: true });
    const trigger = page.getByTestId('right-panel-toggle');
    await trigger.click();

    const panel = page.getByTestId('right-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('allows keyboard traversal to primary shell areas', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/app/workspaces');

    await waitForWorkspaceShellReady(page);
    await pressTabUntilFocused(page, page.locator('a[href="/app/workspaces"]').first());
    await pressTabUntilFocused(page, page.getByRole('searchbox', { name: /page search/i }));
    await pressTabUntilFocused(page, page.getByRole('button', { name: /details|close details/i }));
  });

  test('icon-only shell controls have accessible names', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/workspaces');

    await waitForWorkspaceShellReady(page, { mobile: true });
    await expect(page.getByTestId('mobile-nav-toggle')).toHaveAccessibleName(/menu|\u30e1\u30cb\u30e5\u30fc/i);
    await page.getByTestId('right-panel-toggle').click();
    await expect(page.getByTestId('right-panel-close')).toBeVisible();
    await expect(page.getByTestId('right-panel-close')).toHaveAccessibleName(/close right panel/i);
  });

  for (const route of coreResponsiveRoutes) {
    test(`does not horizontally overflow at 320px: ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(route);
      await expectHealthyAngularPage(page);
      await expectNoDocumentHorizontalOverflow(page);
    });
  }

  test('renders permission-denied shared state without session details', async ({ page }) => {
    await page.goto('/app/permission-denied');

    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.getByTestId('permission-denied-state')).toBeVisible();
    await expect(page.locator('app-shell')).toHaveCount(0);

    const body = page.locator('body');
    await expect(body).not.toContainText('Mock User A');
    await expect(body).not.toContainText('mock-user-a@example.invalid');
    await expect(body).not.toContainText('Support User');
    await expectHealthyAngularPage(page);
  });

  test('uses the canonical Project Kanban for pointer, keyboard, conflict, rollback, and narrow flows', async ({ page }, testInfo) => {
    const api = await installProjectKanbanApi(page);
    if (testInfo.project.name === 'chromium-mobile') {
      await page.setViewportSize({ width: 390, height: 844 });
    } else {
      await page.setViewportSize({ width: 1280, height: 900 });
    }

    await page.goto('/app/projects/static-project-kanban');

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('aip-kanban-board')).toBeVisible();
    await expect(page.getByText('Warning: WIP limit 1 exceeded.')).toBeVisible();
    await expect(page.getByText('Parent summary task')).toBeVisible();
    await expect(page.getByText('Derived progress: 50%')).toBeVisible();
    await expect(page.getByText('Derived dates: 2026-07-01 to 2026-07-31')).toBeVisible();
    await expect(page.getByText('Priority: High')).toBeVisible();
    await expect(page.getByText('Blocked', { exact: true })).toBeVisible();
    await expect(page.getByText(/Done shows 30 recent days/)).toBeVisible();

    const columns = page.locator('.aip-kanban__column');
    if (testInfo.project.name === 'chromium-mobile') {
      const todoBox = await columns.nth(0).boundingBox();
      const doneBox = await columns.nth(1).boundingBox();
      expect(todoBox).not.toBeNull();
      expect(doneBox).not.toBeNull();
      expect(doneBox!.y).toBeGreaterThan(todoBox!.y + todoBox!.height - 1);
      await expectNoDocumentHorizontalOverflow(page);
    }

    let card = page.locator('[data-kanban-card-id="static-task-kanban"]');
    const doneColumn = columns.filter({ has: page.getByRole('heading', { name: 'Done', exact: true }) });
    if (testInfo.project.name === 'chromium-desktop') {
      await card.dragTo(doneColumn);
    } else {
      await card.getByRole('button', { name: 'Move', exact: true }).click();
      await card.getByLabel('Target stage').selectOption('stage-done');
      await card.getByRole('button', { name: 'Apply move' }).click();
    }

    await expect(doneColumn.locator('[data-kanban-card-id="static-task-kanban"]')).toBeVisible();
    await expect(page.getByText('Move saved.', { exact: true })).toBeVisible();
    expect(api.moveBodies).toHaveLength(1);
    expect(api.moveBodies[0]).toMatchObject({
      targetWorkflowStageId: 'stage-done',
      expectedTaskVersion: 3,
      expectedBoardVersion: 7
    });
    expect(api.csrfHeaders).toEqual(['csrf-kanban']);

    card = doneColumn.locator('[data-kanban-card-id="static-task-kanban"]');
    await card.getByRole('button', { name: 'Move', exact: true }).click();
    await card.getByLabel('Target stage').selectOption('stage-todo');
    await card.getByRole('button', { name: 'Apply move' }).click();

    await expect(
      page.getByRole('region', { name: 'Canonical Project Task Kanban' })
        .getByRole('status')
        .filter({ hasText: 'Conflict resolved from the authoritative Project board.' })
    ).toBeVisible();
    card = doneColumn.locator('[data-kanban-card-id="static-task-kanban"]');
    await expect(card).toBeVisible();
    await expect(card).toBeFocused();

    await card.getByRole('button', { name: 'Move', exact: true }).click();
    await card.getByLabel('Target stage').selectOption('stage-todo');
    await card.getByRole('button', { name: 'Apply move' }).click();

    await expect(page.getByRole('alert')).toContainText('Move denied and rolled back.');
    await expect(doneColumn.locator('[data-kanban-card-id="static-task-kanban"]')).toBeVisible();
    expect(api.moveBodies).toHaveLength(3);
    expect(api.csrfHeaders).toEqual(['csrf-kanban', 'csrf-kanban', 'csrf-kanban']);

    await doneColumn.getByRole('button', { name: 'Open details' }).click();
    await expect(page).toHaveURL(/\/app\/projects\/static-project-kanban\/tasks\/static-task-kanban$/);
    expect(api.moveBodies).toHaveLength(3);
  });

  test('keeps the maintained Project Task List when tasks.kanbanV1 is disabled', async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __AIP_FEATURE_FLAGS__?: Record<string, boolean> }).__AIP_FEATURE_FLAGS__ = {
        'tasks.kanbanV1': false
      };
    });
    const api = await installProjectKanbanApi(page);

    await page.goto('/app/projects/static-project-kanban');

    await expect(page.getByText('Project Kanban is disabled. The maintained Task List remains available.')).toBeVisible();
    await expect(page.getByText('Canonical card')).toBeVisible();
    await expect(page.locator('aip-kanban')).toHaveCount(0);
    expect(api.kanbanGetCount()).toBe(0);
  });

  test('does not render protected Kanban data after an authorization denial', async ({ page }) => {
    const api = await installProjectKanbanApi(page, { denySnapshot: true });

    await page.goto('/app/projects/static-project-kanban');

    await expect(page.getByText('Project Kanban is not available.')).toBeVisible();
    await expect(page.locator('[data-kanban-card-id]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('restricted-board-secret');
    expect(api.kanbanGetCount()).toBe(1);
  });

  test('matches approved Angular P0 screenshot baselines', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'chromium-desktop') {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/app/workspaces');
      await waitForWorkspaceShellReady(page);
      await expectStableScreenshot(page, testInfo, 'desktop-shell-workspaces.png', {
        maxDiffPixelRatio: approvedThemeMigrationDiffRatio.desktop
      });
      return;
    }

    if (testInfo.project.name === 'chromium-mobile') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/app/workspaces');
      await waitForWorkspaceShellReady(page, { mobile: true });
      await page.getByTestId('mobile-nav-toggle').click();
      await expect(page.getByTestId('mobile-navigation')).toHaveAttribute('aria-hidden', 'false');
      await expectStableScreenshot(page, testInfo, 'mobile-shell-workspaces-drawer.png', {
        fullPage: false,
        maxDiffPixelRatio: approvedThemeMigrationDiffRatio.mobile
      });
      return;
    }

    throw new Error(`Unexpected Playwright project for Angular screenshots: ${testInfo.project.name}`);
  });
});

async function installProjectKanbanApi(
  page: Page,
  options: { denySnapshot?: boolean } = {}
) {
  let kanbanGets = 0;
  let moveCount = 0;
  const moveBodies: Record<string, unknown>[] = [];
  const csrfHeaders: string[] = [];
  let authoritativeSnapshot = projectKanbanSnapshot('stage-todo', 7, 3);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/security/csrf-token' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'csrf-kanban', headerName: 'X-CSRF-Token' })
      });
      return;
    }

    if (path === '/api/projects/static-project-kanban' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'static-project-kanban',
          title: 'Canonical Project',
          status: 'Active',
          startDate: '2026-07-01',
          endDate: '2026-08-31',
          uiPermissions: { canCreateTask: true }
        })
      });
      return;
    }

    if (path === '/api/projects/static-project-kanban/tasks' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 'static-task-kanban',
            projectId: 'static-project-kanban',
            title: 'Canonical card',
            status: 'Todo',
            stageCategory: 'Todo',
            priority: 'High',
            isBlocked: true,
            primaryAssignee: { userId: 'user-1', displayName: 'Ada' },
            version: 3,
            uiPermissions: { canUpdate: true, rowVersion: '3' }
          }],
          totalCount: 1,
          hasMore: false
        })
      });
      return;
    }

    if (path === '/api/projects/static-project-kanban/kanban' && method === 'GET') {
      kanbanGets += 1;
      if (options.denySnapshot) {
        await route.fulfill({
          status: 403,
          contentType: 'application/problem+json',
          body: JSON.stringify({ title: 'Forbidden', status: 403, detail: 'Project Kanban is not available.' })
        });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritativeSnapshot) });
      }
      return;
    }

    if (path === '/api/projects/static-project-kanban/gantt' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ milestones: [], tasks: [] }) });
      return;
    }
    if (path === '/api/projects/static-project-kanban/workload' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ members: [] }) });
      return;
    }
    if (path === '/api/projects/static-project-kanban/members' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    if (path === '/api/tasks/static-task-kanban/kanban-move' && method === 'POST') {
      moveCount += 1;
      moveBodies.push(request.postDataJSON() as Record<string, unknown>);
      csrfHeaders.push(request.headers()['x-csrf-token'] ?? '');
      if (moveCount === 1) {
        authoritativeSnapshot = projectKanbanSnapshot('stage-done', 8, 4);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ snapshot: authoritativeSnapshot, focusTaskId: 'static-task-kanban', warnings: [] })
        });
      } else if (moveCount === 2) {
        await route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify({ title: 'Conflict', status: 409, detail: 'The board version is stale.', code: 'KANBAN_CONFLICT' })
        });
      } else {
        await route.fulfill({
          status: 403,
          contentType: 'application/problem+json',
          body: JSON.stringify({ title: 'Forbidden', status: 403, detail: 'Move not allowed.', code: 'KANBAN_FORBIDDEN' })
        });
      }
      return;
    }

    await route.fallback();
  });

  return {
    moveBodies,
    csrfHeaders,
    kanbanGetCount: () => kanbanGets
  };
}

function projectKanbanSnapshot(stageId: 'stage-todo' | 'stage-done', boardVersion: number, taskVersion: number) {
  const inTodo = stageId === 'stage-todo';
  return {
    board: {
      projectId: 'static-project-kanban',
      version: boardVersion,
      timeZone: 'UTC',
      defaultSwimlane: 0,
      selectedSwimlane: 0,
      supportedSwimlanes: [0, 1, 2, 3, 4],
      supportedFilters: ['includeOlderCompleted'],
      includesOlderCompleted: false,
      doneWindowDays: 30,
      totalAuthorizedCardCount: 1,
      isTruncated: false,
      uiPermissions: { canConfigure: true },
      warnings: inTodo
        ? [{ code: 'KANBAN_WIP_LIMIT_EXCEEDED', message: 'Todo exceeds its warning limit.', workflowStageId: 'stage-todo', currentCount: 2, limit: 1 }]
        : []
    },
    columns: [
      {
        workflowStageId: 'stage-todo',
        displayName: 'Todo',
        category: 1,
        displayOrder: 1000,
        wipWarningLimit: 1,
        currentAuthorizedCardCount: inTodo ? 2 : 1,
        hasWipWarning: inTodo,
        uiPermissions: { canConfigure: true }
      },
      {
        workflowStageId: 'stage-done',
        displayName: 'Done',
        category: 4,
        displayOrder: 2000,
        wipWarningLimit: null,
        currentAuthorizedCardCount: inTodo ? 0 : 1,
        hasWipWarning: false,
        uiPermissions: { canConfigure: true }
      }
    ],
    cards: [{
      taskId: 'static-task-kanban',
      summary: 'Canonical card',
      workflowStageId: stageId,
      boardOrder: 1000,
      parentTaskId: null,
      parentSummary: null,
      isParentSummary: true,
      isLeaf: false,
      completedChildCount: 1,
      childCount: 2,
      progressPercent: 50,
      plannedStartDate: '2026-07-01',
      plannedEndDate: '2026-07-31',
      primaryAssigneeUserId: 'user-1',
      primaryAssigneeLabel: 'Ada',
      targetGroupId: null,
      targetGroupLabel: 'Ungrouped',
      priority: 2,
      isBlocked: true,
      version: taskVersion,
      swimlaneKey: 'all',
      swimlaneLabel: 'All tasks',
      uiPermissions: {
        canOpen: true,
        canMove: true,
        allowedTargetWorkflowStageIds: ['stage-todo', 'stage-done']
      }
    }]
  };
}

async function expectHealthyAngularPage(page: Page) {
  const body = page.locator('body');
  await expect(body).not.toContainText('Cannot GET /');
  await expect(body).not.toContainText('Application error');
  await expect(body).not.toContainText(/NG0\d+/);
  await expect(body).not.toContainText('TypeError');
  await expect(page.locator('app-root')).toBeAttached();
}

async function waitForWorkspaceShellReady(
  page: Page,
  options: { mobile?: boolean } = {}
) {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('shell-body')).toBeVisible();
  await expect(page.getByTestId('workspace-dashboard')).toBeVisible();

  if (options.mobile) {
    await expect(page.getByTestId('mobile-header')).toBeVisible();
    await expect(page.getByTestId('mobile-nav-toggle')).toBeVisible();
  }
}

async function pressTabUntilFocused(
  page: Page,
  target: Locator,
  maxTabs = 12
) {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) {
      return;
    }

    await page.keyboard.press('Tab');
  }

  await expect(target).toBeFocused();
}

async function expectNoDocumentHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return {
      bodyScrollWidth: body.scrollWidth,
      documentScrollWidth: documentElement.scrollWidth,
      viewportWidth: documentElement.clientWidth
    };
  });

  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth);
}

async function expectStableScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: { fullPage?: boolean; maxDiffPixelRatio?: number } = {}
) {
  await page.evaluate(() => document.fonts?.ready);
  testInfo.annotations.push({
    type: 'Angular P0 screenshot baseline',
    description: name
  });
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: options.fullPage ?? true,
    maxDiffPixelRatio: options.maxDiffPixelRatio,
    scale: 'css'
  });
}
