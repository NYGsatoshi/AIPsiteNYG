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

const workspacePreferenceKey = (tenantId: string, userId: string) =>
  `aip.workspace.last-used:${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}`;

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
    await expect(page.getByTestId('workspace-switcher')).toHaveValue('static-workspace-1');
    await expect(page.getByTestId('workspace-research-status')).toContainText('2 Running');
    await expect(page.getByTestId('workspace-research-status')).toContainText('1 Needs review');
    await expect(page.getByRole('navigation', { name: 'Workspace actions' })).toContainText('Members');
    await expect(page.getByRole('navigation', { name: 'Global actions' })).toContainText('Notifications');
    await expectHealthyAngularPage(page);
  });

  test('requires an explicit Workspace choice when multiple authorized Workspaces have no preference', async ({ page }) => {
    const workspaces = workspaceContextFixtures();
    await installWorkspaceContextApi(page, workspaces, null);

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page);

    const switcher = page.getByTestId('workspace-switcher');
    await expect(switcher).toHaveValue('');
    await expect(page.getByTestId('workspace-selection-status')).toContainText('Choose a Workspace');
    await expect(page.getByTestId('workspace-members-action')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate((key) => globalThis.localStorage.getItem(key), workspacePreferenceKey('mock-tenant', 'mock-user-a')))
      .toBeNull();
  });

  test('switches Workspace with the keyboard and restores the scoped preference', async ({ page }) => {
    const workspaces = workspaceContextFixtures();
    await installWorkspaceContextApi(page, workspaces, null);

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page);

    const switcher = page.getByTestId('workspace-switcher');
    await switcher.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await expect(switcher).toHaveValue('workspace-beta');
    await expect(page.getByTestId('workspace-research-status')).toContainText('0 Running');
    await expect(page.getByTestId('workspace-research-status')).toContainText('0 Needs review');
    const preferenceKey = workspacePreferenceKey('mock-tenant', 'mock-user-a');
    await expect
      .poll(() => page.evaluate((key) => globalThis.localStorage.getItem(key), preferenceKey))
      .toBe('workspace-beta');

    await page.reload();
    await waitForWorkspaceShellReady(page);
    await expect(page.getByTestId('workspace-switcher')).toHaveValue('workspace-beta');
  });

  test('gives a valid route Workspace precedence over the stored preference', async ({ page }) => {
    const workspaces = workspaceContextFixtures();
    const preferenceKey = workspacePreferenceKey('mock-tenant', 'mock-user-a');
    await page.addInitScript(({ key }) => globalThis.localStorage.setItem(key, 'workspace-beta'), {
      key: preferenceKey
    });
    await installWorkspaceContextApi(page, workspaces, null);

    await page.goto('/app/workspaces/workspace-alpha/members');
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('workspace-switcher')).toHaveValue('workspace-alpha');
    await expect
      .poll(() => page.evaluate((key) => globalThis.localStorage.getItem(key), preferenceKey))
      .toBe('workspace-alpha');
  });

  test('discards a stale Workspace preference without selecting the first authorized row', async ({ page }) => {
    const preferenceKey = workspacePreferenceKey('mock-tenant', 'mock-user-a');
    await page.addInitScript(({ key }) => globalThis.localStorage.setItem(key, 'revoked-workspace'), {
      key: preferenceKey
    });
    await installWorkspaceContextApi(page, workspaceContextFixtures(), null);

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page);

    await expect(page.getByTestId('workspace-switcher')).toHaveValue('');
    await expect
      .poll(() => page.evaluate((key) => globalThis.localStorage.getItem(key), preferenceKey))
      .toBeNull();
  });

  test('distinguishes an authorized sole Workspace with unavailable Research counts from zero', async ({ page }) => {
    const workspace = { id: 'workspace-unavailable', name: 'Workspace Unavailable' };
    await installWorkspaceContextApi(page, [workspace], null);

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page);

    await expect(page.getByTestId('workspace-switcher')).toHaveValue(workspace.id);
    await expect(page.getByTestId('workspace-research-status')).toHaveText(/Status unavailable/);
  });

  test('keeps the canonical Research Quick Create flow accessible and duplicate-safe at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const workspace: WorkspaceContextFixture = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Quick Create Workspace',
      currentUserRole: 'Owner',
      canCreateProject: true,
      canAddFiles: true,
      runningProjectCount: 0,
      needsReviewProjectCount: 0
    };
    const projectId = '22222222-2222-4222-8222-222222222222';
    const createRequests: WorkspaceProjectCreateMockRequest[] = [];
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });

    await installWorkspaceContextApi(page, [workspace], workspace);
    await page.route(`**/api/workspaces/${workspace.id}/projects`, async (route) => {
      const request = route.request();
      createRequests.push({
        body: request.postDataJSON() as Record<string, unknown>,
        idempotencyKey: request.headers()['idempotency-key'] ?? '',
        csrfToken: request.headers()['x-csrf-token'] ?? ''
      });
      await createGate;
      await route.fulfill({
        status: 201,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          requestId: 'project-create-201',
          data: {
            id: projectId,
            workspaceId: workspace.id,
            groupId: null,
            ownerUserId: '33333333-3333-4333-8333-333333333333',
            title: 'U-22 Quick Research',
            description: null,
            status: 0,
            visibility: 1,
            activationState: 1,
            startDate: null,
            endDate: null,
            versionNo: 1,
            createdAt: '2026-08-24T05:00:00Z'
          },
          warnings: []
        })
      });
    });

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page, { mobile: true });

    const createGroup = page.getByRole('group', { name: '作成' });
    const primary = page.getByTestId('start-research-action');
    const addFiles = page.getByTestId('add-files-action');
    await expect(createGroup).toBeVisible();
    await expect(primary).toHaveCount(1);
    await expect(addFiles).toHaveAttribute(
      'href',
      `/app/workspaces/${workspace.id}/files#upload`
    );
    await expect.poll(() => primary.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect.poll(() => addFiles.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    await pressTabUntilFocused(page, primary, 20);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/app/workspaces/${workspace.id}/research/new`);
    await expect(page.getByText('リサーチはWorkspace内のProjectとして作成されます')).toBeVisible();
    await expect(page.getByText(/下書き/)).toBeVisible();
    await expect(page.getByText(/Planning/)).toHaveCount(0);
    await expect(
      page.locator('[name="description"], [name="groupId"], [name="startDate"], [name="endDate"]')
    ).toHaveCount(0);

    const title = page.getByTestId('quick-create-research-title');
    const submit = page.getByTestId('quick-create-submit');
    await submit.click();
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(title).toHaveAttribute('aria-describedby', 'research-title-error');
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);

    await title.fill('  U-22 Quick Research  ');
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname === `/api/workspaces/${workspace.id}/projects`
    );
    await submit.click();
    await expect.poll(() => createRequests.length).toBe(1);
    await page.keyboard.press('Enter');
    await expect.poll(() => createRequests.length).toBe(1);
    releaseCreate();
    expect((await response).status()).toBe(201);

    await expect(page).toHaveURL(`/app/projects/${projectId}`);
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]?.body).toEqual({ title: 'U-22 Quick Research' });
    expect(createRequests[0]?.idempotencyKey).toMatch(/^workspace-research-/);
    expect(createRequests[0]?.csrfToken).toBe('csrf-workspace-create');
  });

  test('fails closed when the backend does not grant Workspace creation', async ({ page }) => {
    const api = await installWorkspaceContextApi(
      page,
      workspaceContextFixtures(),
      null,
      { canCreate: false }
    );

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page);

    await expect(page.getByTestId('create-workspace-action')).toHaveCount(0);
    await expect(page.getByTestId('workspace-empty-create-action')).toHaveCount(0);
    expect(api.createRequests).toEqual([]);
  });

  test('opens Workspace creation from the authorized empty state', async ({ page }) => {
    const api = await installWorkspaceContextApi(page, [], null, { canCreate: true });

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page);

    const emptyStateAction = page.getByTestId('workspace-empty-create-action');
    await expect(page.getByTestId('workspace-empty-state')).toBeVisible();
    await expect(emptyStateAction).toBeVisible();
    await emptyStateAction.click();
    await expect(page.getByRole('dialog', { name: 'Create Workspace' })).toBeVisible();
    await expect(page.getByTestId('workspace-create-name')).toBeFocused();
    expect(api.createRequests).toEqual([]);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(emptyStateAction).toBeFocused();
    expect(api.createRequests).toEqual([]);
  });

  test('keeps Workspace creation cancellable, keyboard-contained, and reachable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const api = await installWorkspaceContextApi(
      page,
      workspaceContextFixtures(),
      null,
      { canCreate: true }
    );

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page, { mobile: true });

    const opener = page.getByTestId('create-workspace-action');
    await opener.click();

    const dialog = page.getByRole('dialog', { name: 'Create Workspace' });
    const name = page.getByTestId('workspace-create-name');
    await expect(dialog).toBeVisible();
    await expect(name).toBeFocused();
    await expect(page.locator('[name="workspaceId"], [name="id"], [name="slug"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Create Workspace' }).click();
    const errorSummary = page.getByTestId('workspace-create-error-summary');
    await expect(errorSummary).toBeFocused();
    await expect(errorSummary).toContainText('Enter a Workspace name');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(api.createRequests).toEqual([]);

    await errorSummary.getByRole('link', { name: 'Enter a Workspace name.' }).click();
    await expect(name).toBeFocused();
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    }
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(api.createRequests).toEqual([]);

    await opener.click();
    await expect(name).toBeFocused();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(api.createRequests).toEqual([]);
  });

  test('submits Workspace creation once in flight and safely reuses the request identity after a 503', async ({ page }) => {
    const existingWorkspace = workspaceContextFixtures()[0];
    const createdWorkspace: WorkspaceContextFixture = {
      id: 'c68465db-8058-4a2f-ae3e-df457fe69d52',
      name: 'Evidence Workspace',
      runningProjectCount: 0,
      needsReviewProjectCount: 0
    };
    let releaseFirstPost!: () => void;
    const firstPostGate = new Promise<void>((resolve) => {
      releaseFirstPost = resolve;
    });
    const api = await installWorkspaceContextApi(
      page,
      [existingWorkspace],
      existingWorkspace,
      {
        canCreate: true,
        onCreate: async (_request, attempt) => {
          if (attempt === 1) {
            await firstPostGate;
            return {
              status: 503,
              body: {
                requestId: 'workspace-create-503',
                error: {
                  code: 'DependencyUnavailable',
                  message: 'Workspace creation is temporarily unavailable.',
                  target: 'workspace',
                  details: [],
                  redactionApplied: false
                },
                traceId: 'workspace-create-503',
                status: 503
              }
            };
          }

          return {
            status: 201,
            workspace: createdWorkspace,
            body: {
              requestId: 'workspace-create-201',
              data: {
                id: createdWorkspace.id,
                name: createdWorkspace.name,
                description: 'Evidence for the U-22 demo',
                icon: null,
                status: 0,
                createdByUserId: 'a7ad8352-2012-4328-8318-7d9c466af46d',
                createdAt: '2026-08-24T05:00:00Z',
                updatedAt: null
              },
              warnings: []
            }
          };
        }
      }
    );

    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page);
    await page.getByTestId('create-workspace-action').click();
    await page.getByTestId('workspace-create-name').fill(`  ${createdWorkspace.name}  `);
    await page.getByTestId('workspace-create-description').fill('Evidence for the U-22 demo');

    const firstResponse = waitForWorkspaceCreateResponse(page);
    await page.getByRole('button', { name: 'Create Workspace' }).click();
    await expect.poll(() => api.createRequests.length).toBe(1);
    await expect(page.locator('.aip-dialog__confirm')).toBeDisabled();

    // Native submit plus the facade's synchronous busy guard must suppress a
    // second request even if Enter is pressed while the first response waits.
    await page.getByTestId('workspace-create-name').press('Enter');
    await expect.poll(() => api.createRequests.length).toBe(1);

    releaseFirstPost();
    expect((await firstResponse).status()).toBe(503);
    await expect(page.getByTestId('workspace-create-error-summary')).toContainText(
      'The Workspace may have been created. Retry with the same details'
    );

    const retryResponse = waitForWorkspaceCreateResponse(page);
    await page.getByRole('button', { name: 'Create Workspace' }).click();
    expect((await retryResponse).status()).toBe(201);

    await expect(page).toHaveURL(/\/app\/workspaces$/);
    await expect(page.getByTestId('workspace-card').filter({ hasText: createdWorkspace.name })).toBeVisible();
    await expect(page.getByTestId('workspace-switcher')).toHaveValue(createdWorkspace.id);
    await expect(page.getByTestId('workspace-created-announcement')).toContainText(
      `${createdWorkspace.name} Workspace`
    );
    await expect(page.getByTestId('workspace-dashboard')).toBeFocused();

    expect(api.createRequests).toHaveLength(2);
    const [firstRequest, retryRequest] = api.createRequests;
    expect(firstRequest.body).toEqual({
      name: createdWorkspace.name,
      description: 'Evidence for the U-22 demo',
      icon: null
    });
    expect(retryRequest.body).toEqual(firstRequest.body);
    expect(retryRequest.rawBody).toBe(firstRequest.rawBody);
    expect(retryRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
    expect(firstRequest.idempotencyKey).toMatch(/^[\x20-\x7e]{8,128}$/u);
    expect(api.createRequests.every((request) => request.csrfToken === 'csrf-workspace-create')).toBe(true);
    expect(api.workspaceListRequests).toBeGreaterThanOrEqual(2);
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
    await pressTabUntilFocused(page, page.getByTestId('workspace-switcher'));
    await pressTabUntilFocused(page, page.getByTestId('workspace-members-action'));
    await pressTabUntilFocused(page, page.getByTestId('right-panel-toggle'));
    await pressTabUntilFocused(page, page.getByTestId('account-action'));
    await pressTabUntilFocused(page, page.getByTestId('logout-action'));
  });

  test('keeps Workspace and global header actions keyboard reachable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/app/workspaces');
    await waitForWorkspaceShellReady(page, { mobile: true });

    const controls = [
      page.getByTestId('workspace-switcher'),
      page.getByTestId('workspace-members-action'),
      page.getByTestId('right-panel-toggle'),
      page.getByTestId('account-action'),
      page.getByTestId('logout-action')
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      await pressTabUntilFocused(page, control, 20);
    }
    await expectNoDocumentHorizontalOverflow(page);
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

  test('collects a cancellation reason before a pointer drag submits the canonical move', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pointer drag remediation is covered by the desktop browser project.');
    const api = await installProjectKanbanApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/app/projects/static-project-kanban');

    const card = page.locator('[data-kanban-card-id="static-task-kanban"]');
    const todoColumn = page.locator('.aip-kanban__column')
      .filter({ has: page.getByRole('heading', { name: 'Todo', exact: true }) });
    const cancelledColumn = page.locator('.aip-kanban__column')
      .filter({ has: page.getByRole('heading', { name: 'Cancelled', exact: true }) });

    await card.dragTo(cancelledColumn);

    await expect(todoColumn.locator('[data-kanban-card-id="static-task-kanban"]')).toBeVisible();
    await expect(cancelledColumn.locator('[data-kanban-card-id="static-task-kanban"]')).toHaveCount(0);
    await expect(card.getByLabel('Target stage')).toHaveValue('stage-cancelled');
    await expect(card.getByLabel('Position')).toHaveValue('end');
    const applyMove = card.getByRole('button', { name: 'Apply move' });
    await expect(applyMove).toBeDisabled();
    expect(api.moveBodies).toHaveLength(0);

    await card.getByLabel('Reason').fill('Cancelled after stakeholder review.');
    await expect(applyMove).toBeEnabled();
    await applyMove.click();

    await expect(cancelledColumn.locator('[data-kanban-card-id="static-task-kanban"]')).toBeVisible();
    await expect(page.getByText('Move saved.', { exact: true })).toBeVisible();
    expect(api.moveBodies).toHaveLength(1);
    expect(api.moveBodies[0]).toMatchObject({
      targetWorkflowStageId: 'stage-cancelled',
      targetBeforeTaskId: null,
      targetAfterTaskId: null,
      reason: 'Cancelled after stakeholder review.'
    });
    expect(api.csrfHeaders).toEqual(['csrf-kanban']);
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

  test('uses the canonical Schedule tab forms for desktop and the 320px mobile projection', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      (window as Window & { __AIP_FEATURE_FLAGS__?: Record<string, boolean> }).__AIP_FEATURE_FLAGS__ = {
        'tasks.ganttV1': true
      };
    });
    const api = await installProjectGanttApi(page);
    const mobile = testInfo.project.name === 'chromium-mobile';
    await page.setViewportSize(mobile ? { width: 320, height: 800 } : { width: 1280, height: 900 });

    await page.goto('/app/projects/static-project-gantt');
    await page.getByRole('tab', { name: 'Schedule', exact: true }).click();

    await expect(page.getByTestId('project-schedule')).toBeVisible();
    await expect(page.getByTestId('aip-gantt-projection')).toBeVisible();
    await expect(page.getByText('Workspace timezone:')).toContainText('Asia/Tokyo');
    await expect(page.getByText('Derived parent Task', { exact: true })).toBeVisible();
    await expect(page.getByText('50% (derived)', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Schedule warnings' })
      .getByText(/DEPENDENCY_VIOLATION/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Milestones', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unscheduled work', exact: true })).toBeVisible();

    if (mobile) {
      await expect(page.getByRole('heading', { name: 'Timeline chart', exact: true })).toHaveCount(0);
      await expectNoDocumentHorizontalOverflow(page);
    } else {
      await expect(page.getByRole('heading', { name: 'Timeline chart', exact: true })).toBeVisible();
    }

    let scheduleItem = ganttItem(page, 'task-gantt-schedule');
    const scheduleEdit = scheduleItem.getByRole('button', { name: 'Edit dates', exact: true });
    await scheduleEdit.click();
    await page.getByLabel('Planned start').fill('2026-08-03');
    await page.getByLabel('Planned end').fill('2026-08-08');
    await page.getByRole('button', { name: 'Apply schedule' }).click();
    scheduleItem = ganttItem(page, 'task-gantt-schedule');
    await expect(scheduleItem).toContainText('2026-08-03 to 2026-08-08');
    await expectLogicalGanttFocus(scheduleItem);

    await scheduleItem.getByRole('button', { name: 'Edit progress', exact: true }).click();
    await page.getByLabel('Progress percent').fill('40');
    await page.getByRole('button', { name: 'Apply progress' }).click();
    await expect(ganttItem(page, 'task-gantt-schedule')).toContainText('40%');

    const milestone = ganttItem(page, 'milestone-gantt-release');
    await milestone.getByRole('button', { name: 'Edit Milestone date', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit Milestone date' })
      .locator('input[name="milestoneDate"]')
      .fill('2026-08-31');
    await page.getByRole('button', { name: 'Apply schedule' }).click();
    await expect(ganttItem(page, 'milestone-gantt-release')).toContainText('2026-08-31');

    const successor = ganttItem(page, 'task-gantt-successor');
    await successor.getByRole('button', { name: 'Add FS predecessor', exact: true }).click();
    await page.getByLabel('Finish-to-Start predecessor').selectOption('task-gantt-predecessor');
    await page.getByRole('button', { name: 'Add dependency' }).click();
    const addedDependency = page.locator('[data-gantt-dependency-id="dependency-gantt-added"]');
    await expect(addedDependency).toContainText('Predecessor task');
    await expect(addedDependency).toContainText('Dependency successor');

    await addedDependency.getByRole('button', { name: 'Remove FS dependency' }).click();
    await page.getByRole('button', { name: 'Remove dependency', exact: true }).click();
    await expect(page.locator('[data-gantt-dependency-id="dependency-gantt-added"]')).toHaveCount(0);

    scheduleItem = ganttItem(page, 'task-gantt-schedule');
    await scheduleItem.getByRole('button', { name: 'Move to unscheduled', exact: true }).click();
    await page.getByRole('button', { name: 'Clear schedule', exact: true }).click();
    const unscheduled = page.getByRole('heading', { name: 'Unscheduled work', exact: true })
      .locator('..');
    await expect(unscheduled.locator('[data-gantt-item-id="task-gantt-schedule"]')).toBeVisible();
    await expect(ganttItem(page, 'task-gantt-schedule')).toContainText('Unscheduled');

    const requestsBeforeCancel = api.commandBodies.length;
    await ganttItem(page, 'task-gantt-unscheduled').getByRole('button', { name: 'Edit dates', exact: true }).click();
    await page.getByLabel('Planned start').press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(api.commandBodies).toHaveLength(requestsBeforeCancel);
    await expectLogicalGanttFocus(ganttItem(page, 'task-gantt-unscheduled'));

    expect(api.commandBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'schedule', taskId: 'task-gantt-schedule', plannedStartDate: '2026-08-03', plannedEndDate: '2026-08-08' }),
      expect.objectContaining({ kind: 'progress', taskId: 'task-gantt-schedule', progressPercent: 40 }),
      expect.objectContaining({ kind: 'schedule', taskId: 'milestone-gantt-release', milestoneDate: '2026-08-31' }),
      expect.objectContaining({ kind: 'addDependency', successorTaskId: 'task-gantt-successor', predecessorTaskId: 'task-gantt-predecessor' }),
      expect.objectContaining({ kind: 'removeDependency', successorTaskId: 'task-gantt-successor', dependencyId: 'dependency-gantt-added' }),
      expect.objectContaining({ kind: 'schedule', taskId: 'task-gantt-schedule', plannedStartDate: null, plannedEndDate: null })
    ]));
    expect(api.csrfHeaders.every((header) => header === 'csrf-gantt')).toBe(true);
    expect(api.ganttGetCount()).toBeGreaterThan(1);
  });

  test('keeps the maintained read-only Schedule projection when tasks.ganttV1 is disabled', async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __AIP_FEATURE_FLAGS__?: Record<string, boolean> }).__AIP_FEATURE_FLAGS__ = {
        'tasks.ganttV1': false
      };
    });
    const api = await installProjectGanttApi(page);

    await page.goto('/app/projects/static-project-gantt');
    await page.getByRole('tab', { name: 'Schedule', exact: true }).click();

    await expect(page.getByText(
      'Canonical Gantt presentation is disabled. This maintained read-only list is derived from the same authoritative HTTP snapshot.',
      { exact: true }
    )).toBeVisible();
    await expect(page.getByText(/Schedule is read-only because the current API/)).toBeVisible();
    await expect(page.getByText(/Canonical schedule task/)).toBeVisible();
    await expect(page.locator('[data-gantt-item-id]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Edit dates|Edit progress|Add FS predecessor/ })).toHaveCount(0);
    expect(api.ganttGetCount()).toBe(1);
    expect(api.commandBodies).toHaveLength(0);
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

async function installProjectGanttApi(page: Page) {
  let snapshot = projectGanttSnapshot();
  let ganttGets = 0;
  const commandBodies: Record<string, unknown>[] = [];
  const csrfHeaders: string[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/security/csrf-token' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'csrf-gantt', headerName: 'X-CSRF-Token' })
      });
      return;
    }

    if (path === '/api/projects/static-project-gantt' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'static-project-gantt',
          title: 'Canonical Gantt Project',
          status: 'Active',
          startDate: '2026-07-01',
          endDate: '2026-09-30',
          uiPermissions: { canCreateTask: true }
        })
      });
      return;
    }

    if (path === '/api/projects/static-project-gantt/tasks' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], totalCount: 0, hasMore: false })
      });
      return;
    }

    if (path === '/api/projects/static-project-gantt/kanban' && method === 'GET') {
      const board = projectKanbanSnapshot('stage-todo', 1, 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...board,
          board: {
            ...board.board,
            projectId: 'static-project-gantt',
            totalAuthorizedCardCount: 0,
            warnings: []
          },
          columns: board.columns.map((column) => ({
            ...column,
            currentAuthorizedCardCount: 0,
            hasWipWarning: false
          })),
          cards: []
        })
      });
      return;
    }

    if (path === '/api/projects/static-project-gantt/gantt' && method === 'GET') {
      ganttGets += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(snapshot)
      });
      return;
    }

    if (path === '/api/projects/static-project-gantt/workload' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ members: [] }) });
      return;
    }

    if (path === '/api/projects/static-project-gantt/members' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    const scheduleMatch = /^\/api\/tasks\/([^/]+)\/schedule$/.exec(path);
    if (scheduleMatch && method === 'PATCH') {
      const taskId = scheduleMatch[1];
      const body = request.postDataJSON() as Record<string, unknown>;
      commandBodies.push({ kind: 'schedule', taskId, ...body });
      csrfHeaders.push(request.headers()['x-csrf-token'] ?? '');
      const item = findGanttDto(snapshot, taskId);
      expect(body['expectedVersion']).toBe(item.version);
      const updated = {
        ...item,
        plannedStartDate: body['plannedStartDate'] as string | null,
        plannedEndDate: body['plannedEndDate'] as string | null,
        milestoneDate: body['milestoneDate'] as string | null,
        version: item.version + 1
      };
      if (updated.kind === 'Task' && updated.plannedStartDate === null && updated.plannedEndDate === null) {
        updated.warnings = mergeWarningDto(updated.warnings, ganttWarningDto(
          'UNSCHEDULED',
          'Task is unscheduled.',
          'Task',
          updated.taskId
        ));
      } else {
        updated.warnings = updated.warnings.filter((warning) => warning.code !== 'UNSCHEDULED');
      }
      snapshot = replaceGanttDto(snapshot, updated);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ganttCommandDto(updated))
      });
      return;
    }

    const progressMatch = /^\/api\/tasks\/([^/]+)\/progress$/.exec(path);
    if (progressMatch && method === 'PATCH') {
      const taskId = progressMatch[1];
      const body = request.postDataJSON() as Record<string, unknown>;
      commandBodies.push({ kind: 'progress', taskId, ...body });
      csrfHeaders.push(request.headers()['x-csrf-token'] ?? '');
      const item = findGanttDto(snapshot, taskId);
      expect(body['expectedVersion']).toBe(item.version);
      const updated = {
        ...item,
        progressPercent: Number(body['progressPercent']),
        version: item.version + 1
      };
      snapshot = replaceGanttDto(snapshot, updated);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ganttCommandDto(updated))
      });
      return;
    }

    const dependencyAddMatch = /^\/api\/tasks\/([^/]+)\/dependencies$/.exec(path);
    if (dependencyAddMatch && method === 'POST') {
      const successorTaskId = dependencyAddMatch[1];
      const body = request.postDataJSON() as Record<string, unknown>;
      commandBodies.push({
        kind: 'addDependency',
        successorTaskId,
        predecessorTaskId: body['predecessorTaskId'],
        expectedVersion: body['expectedVersion']
      });
      csrfHeaders.push(request.headers()['x-csrf-token'] ?? '');
      const successor = findGanttDto(snapshot, successorTaskId);
      expect(body['expectedVersion']).toBe(successor.version);
      const version = successor.version + 1;
      snapshot = replaceGanttDto(snapshot, { ...successor, version });
      snapshot = {
        ...snapshot,
        projectVersion: snapshot.projectVersion + 1,
        dependencies: [...snapshot.dependencies, {
          dependencyId: 'dependency-gantt-added',
          predecessorTaskId: String(body['predecessorTaskId']),
          successorTaskId,
          type: 'FinishToStart',
          editable: true,
          version,
          warnings: []
        }]
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'dependency-gantt-added',
          predecessorTaskId: String(body['predecessorTaskId']),
          successorTaskId,
          dependencyType: 'FinishToStart',
          createdAt: '2026-07-30T00:00:00Z',
          version,
          editable: true,
          warnings: []
        })
      });
      return;
    }

    const dependencyRemoveMatch = /^\/api\/tasks\/([^/]+)\/dependencies\/([^/]+)$/.exec(path);
    if (dependencyRemoveMatch && method === 'DELETE') {
      const [, successorTaskId, dependencyId] = dependencyRemoveMatch;
      const successor = findGanttDto(snapshot, successorTaskId);
      expect(url.searchParams.get('expectedVersion')).toBe(String(successor.version));
      commandBodies.push({
        kind: 'removeDependency',
        successorTaskId,
        dependencyId,
        expectedVersion: successor.version
      });
      csrfHeaders.push(request.headers()['x-csrf-token'] ?? '');
      snapshot = replaceGanttDto(snapshot, { ...successor, version: successor.version + 1 });
      snapshot = {
        ...snapshot,
        projectVersion: snapshot.projectVersion + 1,
        dependencies: snapshot.dependencies.filter((dependency) => dependency.dependencyId !== dependencyId)
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'OK' })
      });
      return;
    }

    await route.fallback();
  });

  return {
    commandBodies,
    csrfHeaders,
    ganttGetCount: () => ganttGets
  };
}

type MockGanttWarning = {
  code: string;
  message: string;
  severity: 'Info' | 'Warning';
  targetType: string;
  targetId: string | null;
  field: string | null;
  blocking: false;
};

type MockGanttItem = {
  taskId: string;
  kind: 'Task' | 'Milestone';
  parentTaskId: string | null;
  milestoneId: string | null;
  title: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  milestoneDate: string | null;
  progressPercent: number;
  progressIsDerived: boolean;
  workflowStageId: string | null;
  workflowStageName: string | null;
  stageCategory: 'Backlog' | 'Todo' | 'InProgress' | 'Review' | 'Done' | 'Cancelled';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  isBlocked: boolean;
  primaryAssignee: { userId: string; displayName: string } | null;
  version: number;
  scheduleEditPermissions: MockGanttPermissions;
  warnings: MockGanttWarning[];
};

type MockGanttPermissions = {
  canEditSchedule: boolean;
  canEditProgress: boolean;
  canManageDependencies: boolean;
  canClearSchedule: boolean;
  canOpen: boolean;
};

type MockGanttSnapshot = {
  projectId: string;
  projectTitle: string;
  projectVersion: number;
  workflowVersion: number;
  calendarVersion: number | null;
  calendar: {
    timeZone: string;
    workingDays: string[];
    holidaysAvailable: boolean;
    limitations: string[];
  };
  scheduledItems: MockGanttItem[];
  unscheduledItems: MockGanttItem[];
  milestones: MockGanttItem[];
  dependencies: {
    dependencyId: string;
    predecessorTaskId: string;
    successorTaskId: string;
    type: 'FinishToStart' | 'StartToStart' | 'FinishToFinish' | 'StartToFinish';
    editable: boolean;
    version: number;
    warnings: MockGanttWarning[];
  }[];
  warnings: MockGanttWarning[];
  permissions: MockGanttPermissions;
  maximumItems: number;
  totalItems: number;
};

const ganttEditorPermissions: MockGanttPermissions = {
  canEditSchedule: true,
  canEditProgress: true,
  canManageDependencies: true,
  canClearSchedule: true,
  canOpen: true
};

function projectGanttSnapshot(): MockGanttSnapshot {
  const parentPermissions = {
    ...ganttEditorPermissions,
    canEditSchedule: false,
    canEditProgress: false,
    canClearSchedule: false
  };
  const milestonePermissions = {
    ...ganttEditorPermissions,
    canEditProgress: false,
    canManageDependencies: false,
    canClearSchedule: false
  };
  const parentWarning = ganttWarningDto(
    'PARENT_DERIVED',
    'Parent schedule and progress are derived from child Tasks.',
    'Task',
    'task-gantt-parent'
  );
  const dependencyWarning = ganttWarningDto(
    'DEPENDENCY_VIOLATION',
    'The successor begins before its predecessor finishes; dates were not moved.',
    'Dependency',
    'dependency-gantt-existing',
    'plannedStartDate'
  );
  const legacyWarning = ganttWarningDto(
    'LEGACY_DEPENDENCY_TYPE',
    'This legacy non-FS dependency is read-only.',
    'Dependency',
    'dependency-gantt-legacy',
    'type'
  );

  return {
    projectId: 'static-project-gantt',
    projectTitle: 'Canonical Gantt Project',
    projectVersion: 11,
    workflowVersion: 5,
    calendarVersion: null,
    calendar: {
      timeZone: 'Asia/Tokyo',
      workingDays: [],
      holidaysAvailable: false,
      limitations: ['Holiday dates are unavailable from the current canonical calendar service.']
    },
    scheduledItems: [
      ganttTaskDto({
        taskId: 'task-gantt-parent',
        title: 'Derived parent',
        plannedStartDate: '2026-07-01',
        plannedEndDate: '2026-07-10',
        progressPercent: 50,
        progressIsDerived: true,
        scheduleEditPermissions: parentPermissions,
        warnings: [parentWarning]
      }),
      ganttTaskDto({
        taskId: 'task-gantt-schedule',
        parentTaskId: 'task-gantt-parent',
        title: 'Canonical schedule task',
        plannedStartDate: '2026-07-03',
        plannedEndDate: '2026-07-06',
        progressPercent: 25,
        isBlocked: true,
        priority: 'Critical',
        version: 3,
        warnings: [dependencyWarning]
      }),
      ganttTaskDto({
        taskId: 'task-gantt-predecessor',
        parentTaskId: 'task-gantt-parent',
        title: 'Predecessor task',
        plannedStartDate: '2026-07-01',
        plannedEndDate: '2026-07-10',
        progressPercent: 75,
        version: 2
      }),
      ganttTaskDto({
        taskId: 'task-gantt-successor',
        title: 'Dependency successor',
        plannedStartDate: '2026-07-15',
        plannedEndDate: '2026-07-20',
        version: 4
      })
    ],
    unscheduledItems: [
      ganttTaskDto({
        taskId: 'task-gantt-unscheduled',
        title: 'Unscheduled task',
        version: 2,
        warnings: [ganttWarningDto('UNSCHEDULED', 'Task is unscheduled.', 'Task', 'task-gantt-unscheduled')]
      })
    ],
    milestones: [{
      ...ganttTaskDto({
        taskId: 'milestone-gantt-release',
        title: 'Release Milestone',
        version: 4,
        scheduleEditPermissions: milestonePermissions
      }),
      kind: 'Milestone',
      milestoneDate: '2026-07-31'
    }],
    dependencies: [
      {
        dependencyId: 'dependency-gantt-existing',
        predecessorTaskId: 'task-gantt-predecessor',
        successorTaskId: 'task-gantt-schedule',
        type: 'FinishToStart',
        editable: true,
        version: 3,
        warnings: [dependencyWarning]
      },
      {
        dependencyId: 'dependency-gantt-legacy',
        predecessorTaskId: 'task-gantt-predecessor',
        successorTaskId: 'task-gantt-unscheduled',
        type: 'StartToStart',
        editable: false,
        version: 2,
        warnings: [legacyWarning]
      }
    ],
    warnings: [dependencyWarning, legacyWarning],
    permissions: ganttEditorPermissions,
    maximumItems: 20,
    totalItems: 6
  };
}

function ganttTaskDto(overrides: Partial<MockGanttItem>): MockGanttItem {
  return {
    taskId: 'task-gantt',
    kind: 'Task',
    parentTaskId: null,
    milestoneId: null,
    title: 'Task',
    plannedStartDate: null,
    plannedEndDate: null,
    milestoneDate: null,
    progressPercent: 0,
    progressIsDerived: false,
    workflowStageId: 'stage-todo',
    workflowStageName: 'Todo',
    stageCategory: 'Todo',
    priority: 'High',
    isBlocked: false,
    primaryAssignee: { userId: 'user-gantt', displayName: 'Schedule Editor' },
    version: 1,
    scheduleEditPermissions: ganttEditorPermissions,
    warnings: [],
    ...overrides
  };
}

function ganttWarningDto(
  code: string,
  message: string,
  targetType: string,
  targetId: string,
  field: string | null = null
): MockGanttWarning {
  return {
    code,
    message,
    severity: 'Warning',
    targetType,
    targetId,
    field,
    blocking: false
  };
}

function mergeWarningDto(warnings: MockGanttWarning[], warning: MockGanttWarning): MockGanttWarning[] {
  return [...warnings.filter((candidate) => candidate.code !== warning.code), warning];
}

function findGanttDto(snapshot: MockGanttSnapshot, taskId: string): MockGanttItem {
  const item = [...snapshot.scheduledItems, ...snapshot.unscheduledItems, ...snapshot.milestones]
    .find((candidate) => candidate.taskId === taskId);
  if (!item) throw new Error(`Unexpected mocked Gantt WorkItem: ${taskId}`);
  return item;
}

function replaceGanttDto(snapshot: MockGanttSnapshot, updated: MockGanttItem): MockGanttSnapshot {
  const without = (items: MockGanttItem[]) => items.filter((item) => item.taskId !== updated.taskId);
  const scheduledItems = without(snapshot.scheduledItems);
  const unscheduledItems = without(snapshot.unscheduledItems);
  const milestones = without(snapshot.milestones);
  if (updated.kind === 'Milestone') {
    milestones.push(updated);
  } else if (updated.plannedStartDate === null && updated.plannedEndDate === null) {
    unscheduledItems.push(updated);
  } else {
    scheduledItems.push(updated);
  }
  return {
    ...snapshot,
    projectVersion: snapshot.projectVersion + 1,
    scheduledItems,
    unscheduledItems,
    milestones
  };
}

function ganttCommandDto(item: MockGanttItem) {
  return {
    taskId: item.taskId,
    kind: item.kind,
    plannedStartDate: item.plannedStartDate,
    plannedEndDate: item.plannedEndDate,
    milestoneDate: item.milestoneDate,
    progressPercent: item.progressPercent,
    version: item.version,
    warnings: item.warnings
  };
}

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
      const moveBody = request.postDataJSON() as Record<string, unknown>;
      moveBodies.push(moveBody);
      csrfHeaders.push(request.headers()['x-csrf-token'] ?? '');
      if (moveCount === 1) {
        authoritativeSnapshot = projectKanbanSnapshot(projectKanbanStageId(moveBody['targetWorkflowStageId']), 8, 4);
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

type ProjectKanbanStageId = 'stage-todo' | 'stage-done' | 'stage-cancelled';

function projectKanbanSnapshot(stageId: ProjectKanbanStageId, boardVersion: number, taskVersion: number) {
  const inTodo = stageId === 'stage-todo';
  const inDone = stageId === 'stage-done';
  const inCancelled = stageId === 'stage-cancelled';
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
        currentAuthorizedCardCount: inDone ? 1 : 0,
        hasWipWarning: false,
        uiPermissions: { canConfigure: true }
      },
      {
        workflowStageId: 'stage-cancelled',
        displayName: 'Cancelled',
        category: 5,
        displayOrder: 3000,
        wipWarningLimit: null,
        currentAuthorizedCardCount: inCancelled ? 1 : 0,
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
        allowedTargetWorkflowStageIds: ['stage-todo', 'stage-done', 'stage-cancelled']
      }
    }]
  };
}

function projectKanbanStageId(value: unknown): ProjectKanbanStageId {
  if (value === 'stage-todo' || value === 'stage-done' || value === 'stage-cancelled') return value;
  throw new Error(`Unexpected mocked Kanban target Stage: ${String(value)}`);
}

interface WorkspaceContextFixture {
  readonly id: string;
  readonly name: string;
  readonly currentUserRole?: string;
  readonly canCreateProject?: boolean;
  readonly canAddFiles?: boolean;
  readonly runningProjectCount?: number;
  readonly needsReviewProjectCount?: number;
}

interface WorkspaceProjectCreateMockRequest {
  readonly body: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly csrfToken: string;
}

interface WorkspaceCreateMockRequest {
  readonly body: Record<string, unknown>;
  readonly rawBody: string;
  readonly idempotencyKey: string;
  readonly csrfToken: string;
}

interface WorkspaceCreateMockResponse {
  readonly status: number;
  readonly body: unknown;
  readonly workspace?: WorkspaceContextFixture;
}

interface WorkspaceContextApiOptions {
  readonly canCreate?: boolean;
  readonly onCreate?: (
    request: WorkspaceCreateMockRequest,
    attempt: number
  ) => WorkspaceCreateMockResponse | Promise<WorkspaceCreateMockResponse>;
}

interface WorkspaceContextApiHarness {
  readonly createRequests: readonly WorkspaceCreateMockRequest[];
  readonly workspaceListRequests: number;
}

function workspaceContextFixtures(): readonly WorkspaceContextFixture[] {
  return [
    {
      id: 'workspace-alpha',
      name: 'Workspace Alpha',
      runningProjectCount: 2,
      needsReviewProjectCount: 1
    },
    {
      id: 'workspace-beta',
      name: 'Workspace Beta',
      runningProjectCount: 0,
      needsReviewProjectCount: 0
    }
  ];
}

async function installWorkspaceContextApi(
  page: Page,
  workspaces: readonly WorkspaceContextFixture[],
  currentWorkspace: WorkspaceContextFixture | null,
  options: WorkspaceContextApiOptions = {}
): Promise<WorkspaceContextApiHarness> {
  const authorizedWorkspaces = [...workspaces];
  const createRequests: WorkspaceCreateMockRequest[] = [];
  let workspaceListRequests = 0;

  const dashboardItems = () => authorizedWorkspaces.map((workspace) => ({
      ...workspace,
      description: `${workspace.name} Playwright fixture`,
      icon: null,
      status: 'Active',
      createdAt: '2026-07-06T00:00:00Z',
      updatedAt: '2026-07-06T00:00:00Z',
      currentUserRole: workspace.currentUserRole ?? 'Member',
      accessSource: 'WorkspaceMembership',
      canOpenWorkspace: true,
      canOpenMembers: true,
      canOpenProjects: true,
      canCreateProject: workspace.canCreateProject === true,
      canAddFiles: workspace.canAddFiles === true,
      unreadAnnouncementCount: 0,
      unreadConversationCount: 0,
      inProgressProjectCount:
        workspace.runningProjectCount === undefined || workspace.needsReviewProjectCount === undefined
          ? undefined
          : workspace.runningProjectCount + workspace.needsReviewProjectCount
    }));

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        userId: 'mock-user-a',
        displayName: 'Mock User A',
        email: 'mock-user-a@example.invalid',
        systemRole: 'TenantUser',
        status: 'Active',
        capabilities: ['workspace:view', 'announcements:view', 'projects:view', 'files:view', 'account:view', 'audit:view'],
        currentWorkspace,
        workspaces
      })
    });
  });

  await page.route('**/api/workspaces', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      const record: WorkspaceCreateMockRequest = {
        body,
        rawBody: request.postData() ?? '',
        idempotencyKey: request.headers()['idempotency-key'] ?? '',
        csrfToken: request.headers()['x-csrf-token'] ?? ''
      };
      createRequests.push(record);
      const result = await options.onCreate?.(record, createRequests.length) ?? {
        status: 503,
        body: {
          requestId: 'workspace-create-unconfigured',
          error: {
            code: 'DependencyUnavailable',
            message: 'Workspace creation is unavailable in this fixture.',
            target: 'workspace',
            details: [],
            redactionApplied: false
          },
          traceId: 'workspace-create-unconfigured',
          status: 503
        }
      };
      if (result.workspace && !authorizedWorkspaces.some((workspace) => workspace.id === result.workspace?.id)) {
        authorizedWorkspaces.push(result.workspace);
      }
      await route.fulfill({
        status: result.status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(result.body)
      });
      return;
    }

    if (request.method() !== 'GET') {
      await route.fulfill({ status: 405 });
      return;
    }

    workspaceListRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(dashboardItems())
    });
  });

  await page.route('**/api/workspaces/capabilities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        requestId: 'playwright-workspaces-capabilities',
        data: { canCreate: options.canCreate === true },
        warnings: []
      })
    });
  });

  await page.route('**/api/security/csrf-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ token: 'csrf-workspace-create', headerName: 'X-CSRF-Token' })
    });
  });

  return {
    createRequests,
    get workspaceListRequests() {
      return workspaceListRequests;
    }
  };
}

function waitForWorkspaceCreateResponse(page: Page) {
  return page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/workspaces'
  );
}

function ganttItem(page: Page, taskId: string): Locator {
  return page.locator(`[data-gantt-item-id="${taskId}"]`);
}

async function expectLogicalGanttFocus(item: Locator): Promise<void> {
  await expect.poll(() => item.evaluate((element) =>
    element === document.activeElement || element.contains(document.activeElement)
  )).toBe(true);
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
