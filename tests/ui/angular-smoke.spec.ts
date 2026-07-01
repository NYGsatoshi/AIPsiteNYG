import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

test.describe('MVP-A P0 Angular frontend smoke', () => {
  test('serves the built Angular shell', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.getByText('MVP-A P0 Angular Frontend')).toBeVisible();
    await expect(page.locator('router-outlet')).toBeAttached();
    await expectNoAccessibilityViolations(page);
  });

  test('keeps API paths out of Angular fallback routing', async ({ request }) => {
    const response = await request.get('/api/playwright-angular-smoke');

    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Endpoint not found.' });
  });
});
