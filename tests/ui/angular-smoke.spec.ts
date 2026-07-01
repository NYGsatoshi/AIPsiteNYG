import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

test.describe('MVP-A P0 Angular frontend smoke', () => {
  test('serves the built Angular shell', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.locator('app-shell')).toBeVisible();
    await expect(page.locator('router-outlet').first()).toBeAttached();
    await expect(page.locator('app-shell router-outlet')).toBeAttached();

    const body = page.locator('body');
    await expect(body).not.toContainText('Cannot GET /');
    await expect(body).not.toContainText('Application error');
    await expect(body).not.toContainText(/NG0\d+/);
    await expect(body).not.toContainText('TypeError');

    const bodyText = await body.innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);

    await expectNoAccessibilityViolations(page);
  });

  test('keeps API paths out of Angular fallback routing', async ({ request }) => {
    const response = await request.get('/api/playwright-angular-smoke');

    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Endpoint not found.' });
  });
});
