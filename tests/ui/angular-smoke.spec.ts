import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

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
    await page.goto('/login');

    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.getByTestId('page-placeholder')).toBeVisible();
    await expect(page.getByTestId('page-placeholder')).toHaveAttribute('data-tone', 'public');
    await expect(page.locator('app-shell')).toHaveCount(0);
    await expectHealthyAngularPage(page);
  });

  test('renders the workspace route in the Angular shell', async ({ page }) => {
    await page.goto('/app/workspaces');

    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.locator('a[href="/app/workspaces"]').first()).toBeAttached();
    await expect(page.getByTestId('workspace-dashboard')).toBeVisible();
    await expectHealthyAngularPage(page);
  });

  test('falls back to Angular index.html for unknown user-facing routes', async ({ page, request }) => {
    const response = await request.get('/not-a-real-angular-route');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    await expect(response.text()).resolves.toContain('<app-root');

    await page.goto('/not-a-real-angular-route');
    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.getByTestId('page-placeholder')).toBeVisible();
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

    await expect(page.getByTestId('mobile-header')).toBeVisible();
    await expect(page.getByTestId('account-rail')).toBeHidden();

    const mobileNavigation = page.getByTestId('mobile-navigation');
    await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('mobile-nav-toggle')).toHaveAttribute('aria-expanded', 'false');

    await page.getByTestId('mobile-nav-toggle').click();
    await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'false');
    await expect(page.getByTestId('mobile-nav-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(mobileNavigation.locator('a[href="/app/workspaces"]')).toBeVisible();

    for (const legacyRoute of ['/dashboard', '/messages', '/tenant-admin', '/platform-admin']) {
      await expect(page.locator(`a[href="${legacyRoute}"]`)).toHaveCount(0);
    }

    await expectHealthyAngularPage(page);
  });

  test('allows keyboard traversal to primary shell areas', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/app/workspaces');

    await pressTabUntilFocused(page, page.locator('a[href="/app/workspaces"]').first());
    await pressTabUntilFocused(page, page.getByTestId('page-search'));
    await pressTabUntilFocused(page, page.getByTestId('right-panel-toggle'));
  });

  test('renders permission-denied shared state without session details', async ({ page }) => {
    await page.goto('/permission-denied');

    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.getByTestId('permission-denied-state')).toBeVisible();
    await expect(page.locator('app-shell')).toHaveCount(0);

    const body = page.locator('body');
    await expect(body).not.toContainText('Mock User A');
    await expect(body).not.toContainText('mock-user-a@example.invalid');
    await expect(body).not.toContainText('Support User');
    await expectHealthyAngularPage(page);
  });
});

async function expectHealthyAngularPage(page: Page) {
  const body = page.locator('body');
  await expect(body).not.toContainText('Cannot GET /');
  await expect(body).not.toContainText('Application error');
  await expect(body).not.toContainText(/NG0\d+/);
  await expect(body).not.toContainText('TypeError');

  const bodyText = await body.innerText();
  expect(bodyText.trim().length).toBeGreaterThan(0);
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
