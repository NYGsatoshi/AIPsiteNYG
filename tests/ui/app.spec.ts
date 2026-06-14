import { expect, type Page, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';
import { mockAuthenticatedApp, mockLoginOnly } from './app.fixtures';

async function openPrimaryNavigation(page: Page) {
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary' });
  if ((page.viewportSize()?.width ?? 0) <= 760 && !(await primaryNavigation.isVisible())) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  }
}

async function goToProjects(page: Page) {
  await openPrimaryNavigation(page);
  await page.getByRole('link', { name: /Projects/ }).click();
  await expect(page).toHaveURL(/\/projects/);

  if ((page.viewportSize()?.width ?? 0) <= 760) {
    await expect(page.locator('.app-shell')).not.toHaveClass(/is-sidebar-open/);
  }
}

test('login page shows authentication entry point, validates failures, and has no axe violations', async ({ page }) => {
  await mockLoginOnly(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await page.getByLabel('Email').fill('bad@example.invalid');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('status')).toHaveText('Invalid email or password.');
});

test('dashboard shell renders primary navigation, empty states, and passes axe checks', async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) <= 760) {
    await openPrimaryNavigation(page);
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  } else {
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Projects/ })).toBeVisible();
  }
  await expect(page.getByText('No assigned tasks due soon.')).toBeVisible();
  await expect(page.getByText('No recent conversations.')).toBeVisible();
  await expectNoAccessibilityViolations(page);

  if ((page.viewportSize()?.width ?? 0) <= 760) {
    await goToProjects(page);
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  }
});

test('search route is reachable from the header and preserves the query', async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search' }).fill('production');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/search\?q=production/);
  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  await expect(page.getByText('production')).toBeVisible();
  await expect(page.getByText('Search results UI is not implemented in this slice.')).toBeVisible();
});

test('projects list, empty task state, form validation, and API error state are covered', async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto('/');
  await goToProjects(page);

  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('link', { name: /UI Test Project/ })).toBeVisible();
  await page.getByRole('link', { name: /UI Test Project/ }).click();

  await expect(page.getByRole('heading', { name: 'UI Test Project' })).toBeVisible();
  await page.getByRole('button', { name: 'Tasks' }).click();
  await expect(page.getByText('No tasks yet.')).toBeVisible();

  await page.locator('[data-new-task]').click();
  const taskForm = page.locator('[data-task-form]');
  const submitTaskButton = taskForm.getByRole('button', { name: 'Create task' });

  await page.getByLabel('Title').fill('Task with invalid dates');
  await page.getByLabel('Start date').fill('2026-06-20');
  await page.getByLabel('Due date').fill('2026-06-10');
  await page.keyboard.press('Tab');
  await submitTaskButton.scrollIntoViewIfNeeded();
  await expect(submitTaskButton).toBeVisible();
  await expect(submitTaskButton).toBeEnabled();
  await page.waitForTimeout(300);
  await submitTaskButton.click();
  await expect(page.getByRole('status')).toHaveText('Due date cannot be before start date.');

  await page.unroute('/api/projects/project-ui-test/tasks');
  await page.route('/api/projects/project-ui-test/tasks', async (route) => {
    await route.fulfill({ status: 500, json: { error: 'Project tasks unavailable.' } });
  });
  await page.goto('/');
  await goToProjects(page);
  await page.getByRole('link', { name: /UI Test Project/ }).click();
  await page.getByRole('button', { name: 'Tasks' }).click();

  await expect(page.getByText('Project tasks unavailable.')).toBeVisible();
});
