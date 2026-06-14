import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectNoAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .exclude('[aria-busy="true"]')
    .analyze();

  expect(results.violations).toEqual([]);
}
