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

  test('matches approved Angular P0 screenshot baselines', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'chromium-desktop') {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/app/workspaces');
      await waitForWorkspaceShellReady(page);
      await expectStableScreenshot(page, testInfo, 'desktop-shell-workspaces.png');
      return;
    }

    if (testInfo.project.name === 'chromium-mobile') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/app/workspaces');
      await waitForWorkspaceShellReady(page, { mobile: true });
      await page.getByTestId('mobile-nav-toggle').click();
      await expect(page.getByTestId('mobile-navigation')).toHaveAttribute('aria-hidden', 'false');
      await expectStableScreenshot(page, testInfo, 'mobile-shell-workspaces-drawer.png', { fullPage: false });
      return;
    }

    throw new Error(`Unexpected Playwright project for Angular screenshots: ${testInfo.project.name}`);
  });
});

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
  options: { fullPage?: boolean } = {}
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
    scale: 'css'
  });
}
