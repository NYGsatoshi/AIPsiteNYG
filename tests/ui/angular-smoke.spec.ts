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

  test('keeps the redacted audit drawer deep-linkable, focus-safe, and accessible at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await installAuditGridApi(page, auditGridFixtures(8));

    const firstAuditId = auditGridFixtureId(0);
    await page.goto(`/app/admin/audit?event=${firstAuditId}`);
    const drawer = page.getByTestId('audit-detail-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Audit row 001 was opened with safe fields.');
    await page.getByTestId('audit-detail-close').click();
    await expect(page).toHaveURL(/\/app\/admin\/audit$/);
    await expect(page.getByTestId('audit-log-title')).toBeFocused();

    await page.goto('/app/admin/audit');
    const mobileList = page.getByTestId('audit-log-mobile-list');
    const opener = page.getByTestId('open-audit-mobile-detail').first();
    await expect(mobileList).toBeVisible();
    await opener.click();

    await expect(page).toHaveURL(new RegExp(`/app/admin/audit\\?event=${firstAuditId}$`));
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Audit row 001 was opened with safe fields.');
    await expect(drawer).not.toContainText('restricted body must stay hidden');
    await expect(drawer).not.toContainText('tenant/private/key');
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);

    await page.goBack();
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();

    await page.goForward();
    await expect(drawer).toBeVisible();
    await page.getByTestId('audit-detail-close').click();
    await expect(page).toHaveURL(/\/app\/admin\/audit$/);
    await expect(opener).toBeFocused();
  });

  test('keeps the audit header fixed and restores bounded AG scroll context after drawer close', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'The desktop grid is replaced by the mobile audit list.');
    await installAuditGridApi(page, auditGridFixtures(128));
    await page.goto('/app/admin/audit');

    const grid = page.locator('ag-grid-angular.app-data-grid__grid--sticky-header');
    const header = grid.locator('.ag-header');
    // AG Grid v36 owns the normal-layout scroll on ag-grid-viewport; keep the
    // older class alternatives for the retained adapter's compatible builds.
    const bodyViewport = grid.locator('.ag-grid-viewport, .ag-center-cols-viewport, .ag-body-viewport').first();
    await expect(grid).toBeVisible();
    await expect(header).toBeVisible();
    await expect(bodyViewport).toBeVisible();
    const before = await header.boundingBox();
    await bodyViewport.evaluate((element) => { element.scrollTop = 500; });

    await expect.poll(async () => (await header.boundingBox())?.y).toBeCloseTo(before?.y ?? 0, 1);

    const openerIndex = await bodyViewport.evaluate((viewport) => {
      const viewportBounds = viewport.getBoundingClientRect();
      return Array.from(viewport.querySelectorAll<HTMLButtonElement>('button[data-grid-action="openAuditDetail"]'))
        .findIndex((button) => {
          const bounds = button.getBoundingClientRect();
          return bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom;
        });
    });
    expect(openerIndex).toBeGreaterThanOrEqual(0);
    // Do not let Playwright scroll an offscreen first row back to the top:
    // activate a row already visible in the bounded viewport we are testing.
    const opener = bodyViewport.locator('button[data-grid-action="openAuditDetail"]').nth(openerIndex);
    await expect(opener).toBeVisible();
    const originalScrollTop = await bodyViewport.evaluate((element) => element.scrollTop);
    await opener.click();
    await expect(page.getByTestId('audit-detail-drawer')).toBeVisible();

    // Simulate a user moving the bounded grid while its non-modal inspector
    // is open. Closing must return to the original virtualized row context.
    await bodyViewport.evaluate((element) => { element.scrollTop = 0; });
    await page.getByTestId('audit-detail-close').click();

    await expect.poll(async () => bodyViewport.evaluate((element) => element.scrollTop)).toBeCloseTo(originalScrollTop, 1);
    await expect(opener).toBeFocused();
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

  test('keeps Announcement publish validation and preserved failures accessible at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const workspace: WorkspaceContextFixture = {
      id: '38000000-0000-4000-8000-000000000001',
      name: 'Announcement evidence workspace',
      runningProjectCount: 0,
      needsReviewProjectCount: 0
    };
    await installWorkspaceContextApi(page, [workspace], workspace);
    const api = await installAnnouncementEditorApi(page);

    await page.goto('/app/announcements');
    const create = page.getByTestId('create-announcement-action');
    await expect(create).toBeVisible();
    await create.focus();
    await page.keyboard.press('Enter');

    const title = page.getByTestId('announcement-editor-title');
    const body = page.getByTestId('announcement-editor-body');
    const publish = page.getByTestId('announcement-publish-action');
    await expect(title).toBeVisible();
    await publish.focus();
    await page.keyboard.press('Enter');

    const validationSummary = page.getByTestId('announcement-editor-error-summary');
    await expect(validationSummary).toBeVisible();
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(title).toHaveAttribute('aria-describedby', /announcement-title-error/);
    await expect(body).toHaveAttribute('aria-invalid', 'true');
    await expect(body).toHaveAttribute('aria-describedby', /announcement-body-error/);
    await validationSummary.getByRole('link', { name: /本文を入力してください/ }).focus();
    await page.keyboard.press('Enter');
    await expect(body).toBeFocused();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);

    await title.fill('Accessible announcement');
    await body.fill('The draft must remain available after an API failure.');

    const failedResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/announcements'
    );
    await publish.focus();
    await page.keyboard.press('Enter');
    expect((await failedResponse).status()).toBe(503);
    const submissionError = page.getByTestId('announcement-editor-submission-error');
    await expect(submissionError).toBeVisible();
    await expect(submissionError).toHaveAttribute('role', 'alert');
    await expect(submissionError).toContainText('could not be published right now');
    await expect(submissionError).not.toContainText('internal upstream detail');
    await expect(title).toHaveValue('Accessible announcement');
    await expect(body).toHaveValue('The draft must remain available after an API failure.');

    const succeededResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/announcements'
    );
    await publish.focus();
    await page.keyboard.press('Enter');
    expect((await succeededResponse).status()).toBe(201);
    await expect(page.getByText('お知らせを公開しました。')).toBeVisible();
    expect(api.publishRequests).toHaveLength(2);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);
  });

  test('keeps recipient announcement detail navigable, readable, and confirmable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const workspace: WorkspaceContextFixture = {
      id: '38500000-0000-4000-8000-000000000001',
      name: 'Announcement mobile detail workspace',
      runningProjectCount: 0,
      needsReviewProjectCount: 0
    };
    await installWorkspaceContextApi(page, [workspace], workspace);
    const api = await installAnnouncementMobileDetailApi(page, workspace.id);

    await page.goto('/app/announcements');
    const listRow = page.getByTestId('announcement-list-item').filter({ hasText: 'Mobile recipient detail' });
    await expect(listRow).toBeVisible();
    await page.evaluate(() => { document.scrollingElement!.scrollTop = 160; });
    await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(160);
    await listRow.scrollIntoViewIfNeeded();
    const originScrollTop = await page.evaluate(() => document.scrollingElement!.scrollTop);
    expect(originScrollTop).toBeGreaterThan(0);
    await listRow.click();

    await expect(page).toHaveURL(new RegExp(`/app/announcements/${api.id}$`));
    await expect(page.getByTestId('announcement-detail-title')).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);

    const priority = page.getByTestId('announcement-priority-label');
    const title = page.getByTestId('announcement-detail-title');
    const published = page.getByTestId('announcement-published-at');
    const expiry = page.getByTestId('announcement-expires-at');
    const audience = page.getByTestId('announcement-audience-label');
    const positions = await Promise.all(
      [priority, title, published, expiry, audience].map((locator) =>
        locator.evaluate((element) => element.getBoundingClientRect().top),
      ),
    );
    expect(positions[0]!).toBeLessThan(positions[1]!);
    expect(positions[1]!).toBeLessThan(positions[2]!);
    expect(positions[2]!).toBeLessThan(positions[3]!);
    expect(positions[3]!).toBeLessThan(positions[4]!);
    await expect(expiry).toBeVisible();
    await expect(page.getByTestId('announcement-body-text')).toContainText('long recipient-facing body');
    const action = page.getByTestId('announcement-mark-read-action');
    await expect(action).toBeVisible();
    await expect.poll(() => action.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => { document.scrollingElement!.scrollTop = 480; });
    await expect.poll(() => action.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    })).toBe(true);
    await expect(page.locator('app-message-composer')).toHaveCount(0);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);

    const readResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/announcements/${api.id}/read`,
    );
    await action.click();
    expect((await readResponse).status()).toBe(200);
    expect(api.readRequests).toEqual([{ body: {}, csrfToken: 'csrf-announcement-read' }]);
    await expect(action).toHaveCount(0);
    await expect(page.getByTestId('announcement-read-status')).toBeFocused();

    await page.evaluate(() => { document.scrollingElement!.scrollTop = 0; });
    await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
    await page.getByTestId('announcement-mobile-back').click();
    await expect(page).toHaveURL(/\/app\/announcements$/);
    await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(originScrollTop);
    await expect(listRow).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/announcements$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/app\/announcements$/);
  });

  test('keeps live Announcement edits when a reauthorization refresh is delayed', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const workspace: WorkspaceContextFixture = {
      id: '38000000-0000-4000-8000-000000000001',
      name: 'Announcement evidence workspace',
      runningProjectCount: 0,
      needsReviewProjectCount: 0
    };
    await installWorkspaceContextApi(page, [workspace], workspace);
    const api = await installAnnouncementEditorApi(page, {
      firstPublishFailure: 'audienceAuthorization',
      holdAudienceRefresh: true
    });

    await page.goto('/app/announcements');
    await page.getByTestId('create-announcement-action').click();

    const title = page.getByTestId('announcement-editor-title');
    const body = page.getByTestId('announcement-editor-body');
    const publish = page.getByTestId('announcement-publish-action');
    await title.fill('Submitted title');
    await body.fill('Submitted body');

    const failedResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/announcements'
    );
    await publish.focus();
    await page.keyboard.press('Enter');
    expect((await failedResponse).status()).toBe(400);
    await api.audienceRefreshRequested;

    const submissionError = page.getByTestId('announcement-editor-submission-error');
    await expect(submissionError).toContainText('selected audience is no longer authorized');
    await expect(submissionError).not.toContainText('Announcement audience is not authorized.');

    await title.fill('Live title edited after publish failed');
    await body.fill('Live body edited after publish failed');
    api.releaseAudienceRefresh();

    await expect(page.getByTestId('announcement-audience-unavailable')).toBeVisible();
    await expect(title).toHaveValue('Live title edited after publish failed');
    await expect(body).toHaveValue('Live body edited after publish failed');
    await expect(publish).toBeDisabled();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);
  });

  test('creates a canonical Draft Project once and activates it only through the explicit command', async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === 'chromium-mobile';
    await page.setViewportSize(mobile
      ? { width: 320, height: 900 }
      : { width: 1280, height: 900 });

    const workspace: WorkspaceContextFixture = {
      id: '40900000-0000-4000-8000-000000000001',
      name: 'U-22 Project Workspace',
      currentUserRole: 'Owner',
      canOpenProjectCreate: true,
      canCreateProject: false,
      runningProjectCount: 0,
      needsReviewProjectCount: 0
    };
    const projectId = '40900000-0000-4000-8000-000000000002';
    const groupId = '40900000-0000-4000-8000-000000000003';
    await installWorkspaceContextApi(page, [workspace], workspace);
    const api = await installCanonicalProjectCreateActivationApi(page, {
      workspaceId: workspace.id,
      projectId,
      groupId
    });

    await page.goto(`/app/workspaces/${workspace.id}/projects?create=1`);
    const dialog = page.getByRole('dialog', { name: 'Create Project' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(`/app/workspaces/${workspace.id}/projects`);
    await expect(page.getByTestId('project-create-title')).toBeFocused();
    await expect(page.getByTestId('project-create-group')).toContainText('Evidence Review Group');
    await expect(dialog).not.toContainText(groupId);
    await expect(dialog.locator('input[name="groupId"], input[name="workspaceId"], input[name="ownerUserId"]')).toHaveCount(0);

    const title = page.getByTestId('project-create-title');
    const group = page.getByTestId('project-create-group');
    const startDate = page.getByTestId('project-create-start-date');
    const endDate = page.getByTestId('project-create-end-date');
    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press('Tab');
      await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await title.focus();
    await title.fill('  U-22 Canonical Project  ');
    await page.getByTestId('project-create-description').fill('Canonical create and activation browser evidence.');
    await page.getByTestId('project-create-group-search').fill('Evidence Review');
    await group.selectOption(groupId);
    await startDate.fill('2026-09-10');
    await endDate.fill('2026-09-09');

    const submit = dialog.locator('.aip-dialog__confirm');
    await expect(submit).toHaveText('Create Project');
    await submit.click();
    const errorSummary = page.getByTestId('project-create-error-summary');
    await expect(errorSummary).toBeFocused();
    await expect(errorSummary).toContainText('Target end date cannot be before the start date.');
    expect(api.createRequests).toHaveLength(0);
    await errorSummary.getByRole('link', { name: 'Target end date cannot be before the start date.' }).click();
    await expect(endDate).toBeFocused();
    await endDate.fill('2026-09-20');

    await submit.click();
    await expect
      .poll(
        async () => {
          if (api.createRequests.length === 1) {
            return 'posted';
          }

          const recoveryText = await page
            .getByTestId('project-create-create-status')
            .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? '').join(' '));
          return recoveryText.includes('stopped before it was sent') ? 'stopped' : 'pending';
        },
        { timeout: 10_000 }
      )
      .not.toBe('pending');

    const stoppedBeforeDispatch = api.createRequests.length === 0;
    if (stoppedBeforeDispatch) {
      // The registered authorization clearer can win before browser dispatch.
      // The original form stays local, but the next POST is only user-led
      // after the authoritative options endpoint is rechecked.
      expect(api.createRequests).toHaveLength(0);
      await expect(page.getByTestId('project-create-create-status')).toContainText('stopped before it was sent');
      await page.getByTestId('project-create-options-retry').click();
      await expect(title).toBeVisible();
      expect(api.createRequests, 'reauthorizing options never auto-repeats the create POST').toHaveLength(0);

      const recoveredAttempt = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/workspaces/${workspace.id}/projects`
      );
      api.allowFirstCreateSuccess();
      await submit.click();
      expect((await recoveredAttempt).status()).toBe(201);
    } else {
      // The fixture deterministically holds the first actual POST so this
      // remains the posted/in-flight duplicate-command regression.
      await expect.poll(() => api.createRequests.length).toBe(1);
      const firstAttempt = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/workspaces/${workspace.id}/projects`
      );
      await expect(dialog).toHaveAttribute('aria-busy', 'true');
      await expect(submit).toBeDisabled();
      await expect(submit).toContainText('Working');
      await title.press('Enter');
      await page.waitForTimeout(100);
      expect(api.createRequests, 'Enter cannot duplicate an in-flight Project command').toHaveLength(1);
      api.releaseFirstCreate();
      expect((await firstAttempt).status()).toBe(503);
      await expect(errorSummary).toBeFocused();
      await expect(errorSummary).toContainText('may have been created');

      const secondAttempt = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/workspaces/${workspace.id}/projects`
      );
      await submit.click();
      expect((await secondAttempt).status()).toBe(201);
    }

    const expectedCreateRequestCount = stoppedBeforeDispatch ? 1 : 2;

    await expect(page).toHaveURL(`/app/projects/${projectId}`);
    await expect(page.getByTestId('project-draft-overview')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'U-22 Canonical Project' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(api.projectGetCount).toBeGreaterThanOrEqual(2);
    await expect.poll(() => api.projectListRequests.filter((request) =>
      request.workspaceId === workspace.id && request.includesCreatedProject).length)
      .toBeGreaterThanOrEqual(1);

    const expectedCreateBody = {
      title: 'U-22 Canonical Project',
      description: 'Canonical create and activation browser evidence.',
      groupId,
      visibility: 1,
      startDate: '2026-09-10',
      endDate: '2026-09-20'
    };
    expect(api.createRequests).toHaveLength(expectedCreateRequestCount);
    for (const request of api.createRequests) {
      expect(request.body).toEqual(expectedCreateBody);
    }
    expect(api.createRequests[0]?.idempotencyKey).toMatch(/^project-create-/);
    if (!stoppedBeforeDispatch) {
      expect(api.createRequests[1]?.rawBody).toBe(api.createRequests[0]?.rawBody);
      expect(api.createRequests[1]?.idempotencyKey).toBe(api.createRequests[0]?.idempotencyKey);
    }
    expect(api.createRequests.every((request) => request.csrfToken === 'csrf-workspace-create')).toBe(true);
    expect(api.operationalGetPaths).toEqual([]);

    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);

    await page.goto(`/app/workspaces/${workspace.id}/projects`);
    const createdCard = page.getByTestId('project-summary-card')
      .filter({ hasText: 'U-22 Canonical Project' });
    await expect(createdCard).toBeVisible();
    await expect(createdCard).toContainText('Draft');
    expect(api.createRequests, 'returning to Projects never repeats the create POST').toHaveLength(expectedCreateRequestCount);
    await createdCard.getByRole('link', { name: 'Open U-22 Canonical Project' }).click();
    await expect(page).toHaveURL(`/app/projects/${projectId}`);
    await expect(page.getByTestId('project-draft-overview')).toBeVisible();
    expect(api.createRequests, 'reopening the created Project never repeats the create POST').toHaveLength(expectedCreateRequestCount);
    expect(api.operationalGetPaths).toEqual([]);

    const activate = page.getByTestId('activate-project');
    await activate.focus();
    await expect(activate).toBeFocused();
    const activationResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/projects/${projectId}/activate`
    );
    await page.keyboard.press('Enter');
    expect((await activationResponse).status()).toBe(200);

    const activationStatus = page.locator('.project-detail-page__activation-status');
    await expect(activationStatus).toContainText('Project activated. Operational views were loaded from authoritative state.');
    await expect(activationStatus).toBeFocused();
    await expect(page.getByTestId('project-draft-overview')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Tasks' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Schedule' })).toBeVisible();
    await expect.poll(() => new Set(api.operationalGetPaths).size).toBe(5);
    expect(api.activationRequests).toEqual([{ expectedVersion: 1 }]);
    expect(api.activationCsrfTokens).toEqual(['csrf-workspace-create']);

    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);
    await expectHealthyAngularPage(page);
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

  test('keeps long Project and Task context perceivable on a direct route at 320px', async ({ page }) => {
    const projectId = 'static-project-context';
    const taskId = 'static-task-context';
    const projectTitle = 'A very long parent Project title that must remain identifiable on the narrow Task detail hierarchy';
    const taskTitle = 'A very long current Task title that must remain identifiable on the narrow Task detail hierarchy';
    const api = await installDirectTaskContextApi(page, { projectId, projectTitle, taskId, taskTitle });
    await page.setViewportSize({ width: 320, height: 900 });

    await page.goto(`/app/projects/${projectId}/tasks/${taskId}`);

    const hierarchy = page.getByRole('navigation', { name: 'Project and task hierarchy' });
    const parentProject = page.getByTestId('parent-project-link');
    const currentTask = hierarchy.locator('[aria-current="page"]');
    await expect(hierarchy).toBeVisible();
    await expect(parentProject).toHaveText(projectTitle);
    await expect(parentProject).toHaveAttribute('title', projectTitle);
    await expect(parentProject).toHaveAttribute('href', `/app/projects/${projectId}`);
    await expect(currentTask).toHaveText(taskTitle);
    await expect(currentTask).toHaveAttribute('title', taskTitle);
    await expect(page.getByRole('heading', { level: 1, name: taskTitle })).toBeVisible();
    await expect(page.getByTestId('project-context').getByRole('heading', { name: projectTitle })).toBeVisible();

    const progress = page.getByTestId('task-progress-phase');
    await expect(progress.getByTestId('task-current-phase')).toHaveText('In progress');
    await expect(progress.getByText('Running', { exact: true })).toBeVisible();
    await expect(progress).not.toContainText('%');
    await expect(progress).not.toContainText('Failed');

    const activity = page.getByTestId('task-activity-log');
    const activitySummary = activity.locator('summary');
    await expect(activity).not.toHaveAttribute('open', '');
    expect(api.activityRequests()).toBe(0);
    await activitySummary.focus();
    await page.keyboard.press('Enter');
    await expect(activity).toHaveAttribute('open', '');
    await expect(activity.getByText('Status update', { exact: true })).toBeVisible();
    await expect(activity.getByText('Needs attention', { exact: true })).toBeVisible();
    await expect(activity).not.toContainText('Failed');
    await expect(activity.locator('li').first()).toHaveClass(/task-detail-page__activity-item--status/);
    await expect(activity.locator('time').first()).toHaveAttribute('datetime', '2026-08-24T03:00:00Z');
    expect(api.activityRequests()).toBe(1);
    await activity.getByRole('button', { name: 'Load more activity' }).click();
    await expect(activity.getByText('Decision recorded after review.', { exact: true })).toBeVisible();
    expect(api.activityRequests()).toBe(2);

    const [hierarchyBox, projectBox, taskBox] = await Promise.all([
      hierarchy.boundingBox(),
      parentProject.boundingBox(),
      currentTask.boundingBox()
    ]);
    expect(hierarchyBox).not.toBeNull();
    expect(projectBox).not.toBeNull();
    expect(taskBox).not.toBeNull();
    for (const contextBox of [projectBox!, taskBox!]) {
      expect(contextBox.width).toBeGreaterThan(24);
      expect(contextBox.x).toBeGreaterThanOrEqual(hierarchyBox!.x - 1);
      expect(contextBox.x + contextBox.width).toBeLessThanOrEqual(hierarchyBox!.x + hierarchyBox!.width + 1);
    }
    expect(taskBox!.y).toBeGreaterThan(projectBox!.y);

    expect(api.projectListRequests()).toBe(0);
    expect(api.parentProjectRequests()).toBe(1);
    expect(api.parentProjectAttempts()).toBeGreaterThanOrEqual(1);
    expect(api.parentProjectAttempts()).toBeLessThanOrEqual(2);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);
    await expectHealthyAngularPage(page);
  });

  test('edits and reviews the Task Brief in stable order without narrow-screen overflow', async ({ page }) => {
    await page.addInitScript((storageKey) => globalThis.localStorage.setItem(storageKey, 'light'), themeStorageKey);
    const projectId = 'static-project-brief';
    const taskId = 'static-task-brief';
    const api = await installDirectTaskContextApi(page, {
      projectId,
      projectTitle: 'Authorized Project context',
      taskId,
      taskTitle: 'Structured Task Brief',
      canEdit: true,
      goal: 'Reach editorial review',
      deliverable: 'Review-ready package',
      constraints: 'Keep-the-existing-public-URL-stable-without-breaking-long-unspaced-identifiers'
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/app/projects/${projectId}/tasks/${taskId}`);

    const brief = page.getByTestId('task-brief-fields');
    await expect(brief).toBeVisible();
    await expect(page.getByTestId('task-brief-goal-source')).toHaveText('Task-specific');
    await expect(page.getByTestId('task-brief-deliverable-source')).toHaveText('Task-specific');
    const reviewLabels = await page.getByTestId('task-brief-review').locator('dt').allTextContents();
    expect(reviewLabels).toEqual(['Goal', 'Deliverable', 'Constraints']);

    await page.getByTestId('task-brief-goal-input').fill('Reach final approval');
    await page.getByTestId('task-brief-deliverable-input').fill('');
    await page.getByTestId('task-brief-constraints-input').fill('Preserve the authorized Project boundary');
    await expect(page.getByTestId('task-brief-deliverable-source')).toHaveText('Not set');
    await expect(page.getByTestId('task-brief-review-deliverable')).toContainText('Not set');
    await page.getByTestId('task-save-button').click();

    await expect.poll(() => api.patchBodies().length).toBe(1);
    expect(api.patchBodies()[0]).toMatchObject({
      description: 'Task-specific direct-route context.',
      goal: 'Reach final approval',
      deliverable: null,
      constraints: 'Preserve the authorized Project boundary'
    });
    await expect(page.getByTestId('task-save-success')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page, '[data-testid="task-brief-fields"]');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-aip-theme', 'dark');
    await expectNoAccessibilityViolations(page, '[data-testid="task-brief-fields"]');
    await expectHealthyAngularPage(page);
  });

  test('keeps Activity errors distinct from confirmed empty state and retains earlier pages', async ({ page }, testInfo) => {
    const projectId = 'static-project-activity-errors';
    const taskId = 'static-task-activity-errors';
    await installDirectTaskContextApi(
      page,
      { projectId, projectTitle: 'Activity error Project', taskId, taskTitle: 'Activity error Task' },
      {
        failFirstActivityPageOnce: true,
        failSecondActivityPageOnce: true,
        activityFailureStatus: testInfo.project.name === 'chromium-mobile' ? 409 : 500
      }
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/app/projects/${projectId}/tasks/${taskId}`);

    const activity = page.getByTestId('task-activity-log');
    await activity.locator('summary').click();
    let alert = activity.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(activity).not.toContainText('No Task activity has been recorded.');
    await expect(activity).not.toContainText('0 recorded');
    await alert.getByRole('button', { name: /Retry|Reload/ }).click();

    await expect(activity.getByText('Status update', { exact: true })).toBeVisible();
    await activity.getByRole('button', { name: 'Load more activity' }).click();
    alert = activity.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(activity.getByText('Implementation is ready for review.', { exact: true })).toBeVisible();
    await expect(activity).not.toContainText('No Task activity has been recorded.');
    await alert.getByRole('button', { name: /Retry|Reload/ }).click();

    await expect(activity.getByText('Decision recorded after review.', { exact: true })).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
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
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();

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

  test('keeps the maintained Project Task List when tasks.kanbanV1 is disabled', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      (window as Window & { __AIP_FEATURE_FLAGS__?: Record<string, boolean> }).__AIP_FEATURE_FLAGS__ = {
        'tasks.kanbanV1': false
      };
    });
    const api = await installProjectKanbanApi(page);

    await page.goto('/app/projects/static-project-kanban');
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();

    await expect(page.getByText('Project Kanban is disabled. The maintained Task List remains available.')).toBeVisible();
    const renderer = testInfo.project.name === 'chromium-mobile' ? 'mobile' : 'desktop';
    await expect(page.getByTestId(`task-state-${renderer === 'mobile' ? 'card' : 'row'}-static-task-kanban-${renderer}`)).toBeVisible();
    await expect(page.locator('aip-kanban')).toHaveCount(0);
    expect(api.kanbanGetCount()).toBe(0);
  });

  test('makes canonical Task state, update time, blocking, and Artifact availability scannable at 320px', async ({ page }, testInfo) => {
    const api = await installProjectKanbanApi(page);
    const mobile = testInfo.project.name === 'chromium-mobile';
    await page.setViewportSize(mobile ? { width: 320, height: 900 } : { width: 1280, height: 900 });

    await page.goto('/app/projects/static-project-kanban');
    await page.getByRole('tab', { name: 'List', exact: true }).click();

    const suffix = mobile ? 'mobile' : 'desktop';
    await expect(page.getByTestId('task-state-list')).toBeVisible();
    await expect(page.getByTestId(`task-stage-name-static-task-running-${suffix}`)).toContainText('Investigating');
    await expect(page.getByTestId(`task-category-static-task-running-${suffix}`)).toContainText('Running');
    await expect(page.getByTestId(`task-category-static-task-review-${suffix}`)).toContainText('Needs review');
    await expect(page.getByTestId(`task-category-static-task-completed-${suffix}`)).toContainText('Completed');
    await expect(page.getByTestId(`task-category-static-task-cancelled-${suffix}`)).toContainText('Cancelled');
    await expect(page.getByTestId(`task-blocked-static-task-kanban-${suffix}`)).toContainText('Blocked');
    await expect(page.getByTestId(`task-artifact-static-task-review-${suffix}`)).toContainText('Artifact available');
    await expect(page.getByTestId(`task-artifact-static-task-running-${suffix}`)).toContainText('No artifact');
    await expect(page.getByTestId(`task-updated-static-task-running-${suffix}`).locator('time'))
      .toHaveAttribute('datetime', '2026-08-21T08:15:00Z');
    await expect(page.getByTestId(`task-updated-static-task-review-${suffix}`).locator('time'))
      .toHaveAttribute('datetime', '2026-08-24T02:45:00Z');

    const openAction = page.getByTestId(`task-openDetail-static-task-review-${suffix}`);
    await expect(openAction).toBeVisible();
    await openAction.focus();
    await expect(openAction).toBeFocused();
    expect(api.taskListGetCount()).toBe(1);

    if (mobile) {
      const card = page.getByTestId('task-state-card-static-task-review-mobile');
      const cardBox = await card.boundingBox();
      const actionBox = await openAction.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(actionBox).not.toBeNull();
      expect(cardBox!.x).toBeGreaterThanOrEqual(0);
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(320);
      expect(actionBox!.height).toBeGreaterThanOrEqual(44);
    }

    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);
    await expectHealthyAngularPage(page);
  });

  test('refreshes the Task state list from authoritative HTTP after a stage change', async ({ page }, testInfo) => {
    const api = await installProjectKanbanApi(page);
    await page.setViewportSize(testInfo.project.name === 'chromium-mobile'
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 });
    await page.goto('/app/projects/static-project-kanban');
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();

    const card = page.locator('[data-kanban-card-id="static-task-kanban"]');
    await card.getByRole('button', { name: 'Move', exact: true }).click();
    await card.getByLabel('Target stage').selectOption('stage-done');
    await card.getByRole('button', { name: 'Apply move' }).click();
    await expect(page.getByText('Move saved.', { exact: true })).toBeVisible();

    await expect.poll(api.taskListGetCount).toBeGreaterThan(1);
    await page.getByRole('tab', { name: 'List', exact: true }).click();
    const suffix = testInfo.project.name === 'chromium-mobile' ? 'mobile' : 'desktop';
    await expect(page.getByTestId(`task-stage-name-static-task-kanban-${suffix}`)).toContainText('Complete');
    await expect(page.getByTestId(`task-category-static-task-kanban-${suffix}`)).toContainText('Completed');
    await expect(page.getByTestId(`task-updated-static-task-kanban-${suffix}`).locator('time'))
      .toHaveAttribute('datetime', '2026-08-24T10:15:00Z');
    await expect(page.getByTestId(`task-artifact-static-task-kanban-${suffix}`)).toContainText('Artifact available');
    await expectHealthyAngularPage(page);
  });

  test('does not render protected Kanban data after an authorization denial', async ({ page }) => {
    const api = await installProjectKanbanApi(page, { denySnapshot: true });

    await page.goto('/app/projects/static-project-kanban');
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();

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

async function installDirectTaskContextApi(
  page: Page,
  context: {
    projectId: string;
    projectTitle: string;
    taskId: string;
    taskTitle: string;
    canEdit?: boolean;
    goal?: string | null;
    deliverable?: string | null;
    constraints?: string | null;
  },
  options: {
    failFirstActivityPageOnce?: boolean;
    failSecondActivityPageOnce?: boolean;
    activityFailureStatus?: 409 | 500;
  } = {}
) {
  let projectListRequests = 0;
  let parentProjectRequests = 0;
  let parentProjectAttempts = 0;
  let version = 1;
  let goal = context.goal ?? null;
  let deliverable = context.deliverable ?? null;
  let constraints = context.constraints ?? null;
  const patchBodies: Record<string, unknown>[] = [];
  const briefField = (value: string | null) => ({ value, source: value === null ? 'notSet' : 'taskSpecific' });
  const taskDto = () => ({
    id: context.taskId,
    tenantId: 'mock-tenant',
    workspaceId: 'static-workspace-1',
    projectId: context.projectId,
    kind: 0,
    parentTaskId: null,
    milestoneId: null,
    title: context.taskTitle,
    description: 'Task-specific direct-route context.',
    brief: {
      goal: briefField(goal),
      deliverable: briefField(deliverable),
      constraints: briefField(constraints)
    },
    workflowStageId: 'stage-in-progress',
    workflowStageName: 'In progress',
    status: 1,
    stageCategory: 1,
    isBlocked: false,
    priority: 'High',
    plannedStartDate: '2026-08-20',
    plannedEndDate: '2026-08-27',
    progressPercent: 40,
    progressIsDerived: false,
    primaryAssignee: { userId: 'mock-user-a', displayName: 'Mock User A' },
    reviewStatus: 0,
    version,
    uiPermissions: { canEdit: context.canEdit === true, canAssign: false, canChangeStatus: false, canDelete: false, allowedTransitions: [] }
  });
  let activityRequests = 0;
  const activityPageAttempts = new Map<number, number>();
  page.on('requestfinished', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/projects/${context.projectId}`) {
      parentProjectRequests += 1;
    }
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/security/csrf-token' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'csrf-task-brief', headerName: 'X-CSRF-Token' })
      });
      return;
    }
    if (path === `/api/tasks/${context.taskId}` && request.method() === 'PATCH' && context.canEdit === true) {
      const body = request.postDataJSON() as Record<string, unknown>;
      patchBodies.push(body);
      if ('goal' in body) goal = typeof body['goal'] === 'string' ? body['goal'] : null;
      if ('deliverable' in body) deliverable = typeof body['deliverable'] === 'string' ? body['deliverable'] : null;
      if ('constraints' in body) constraints = typeof body['constraints'] === 'string' ? body['constraints'] : null;
      version += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(taskDto()) });
      return;
    }
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }

    if (path === `/api/tasks/${context.taskId}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          task: taskDto(),
          relationships: { primaryAssignee: { userId: 'mock-user-a', displayName: 'Mock User A' }, collaborators: [], reviewer: null, version },
          permissions: {
            canCreateSubtask: false,
            canCreateChecklistItem: false,
            canUpdateChecklistItems: false,
            canDeleteChecklistItems: false,
            canReorderChecklist: false,
            canCreateComment: false,
            canMarkCommentImportant: false,
            canApplyLabels: false,
            canManageLabelDefinitions: false,
            canAssociateFiles: false,
            canRemoveFiles: false,
            canChangeWatch: false
          },
          checklist: [],
          labels: [],
          watchState: { isWatching: false, isExplicitOptOut: false, automaticSources: [], version: 1 },
          subtasks: { items: [], page: 1, pageSize: 50, totalCount: 0, hasMore: false },
          comments: { items: [], page: 1, pageSize: 20, totalCount: 0, hasMore: false },
          files: { items: [], page: 1, pageSize: 20, totalCount: 0, hasMore: false }
        })
      });
      return;
    }

    if (path === `/api/projects/${context.projectId}/tasks`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ ...taskDto(), brief: undefined }], page: 1, pageSize: 50, totalCount: 1, hasMore: false })
      });
      return;
    }

    if (path === `/api/tasks/${context.taskId}/activity`) {
      activityRequests += 1;
      const activityPage = Number(url.searchParams.get('page') ?? '1');
      const activityPageAttempt = (activityPageAttempts.get(activityPage) ?? 0) + 1;
      activityPageAttempts.set(activityPage, activityPageAttempt);
      if (activityPageAttempt === 1 && (activityPage === 1 ? options.failFirstActivityPageOnce : options.failSecondActivityPageOnce)) {
        const status = options.activityFailureStatus ?? 500;
        await route.fulfill({
          status,
          contentType: 'application/problem+json',
          body: JSON.stringify({ title: status === 409 ? 'Conflict' : 'Activity unavailable', status, detail: 'Task Activity could not be loaded.' })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(activityPage === 1
          ? {
              items: [
                { id: 'activity-status', activityType: 'StatusUpdate', body: 'Implementation is ready for review.', occurredAt: '2026-08-24T03:00:00Z', author: { userId: 'mock-user-a', displayName: 'Mock User A' } },
                { id: 'activity-issue', activityType: 3, body: 'DependencyNeedsAttentionWithoutBreakingTheNarrowLayout012345678901234567890123456789.', occurredAt: '2026-08-24T02:00:00Z', author: { userId: 'mock-user-b', displayName: 'Mock User B' } }
              ],
              page: 1,
              pageSize: 2,
              totalCount: 3,
              hasMore: true
            }
          : {
              items: [
                { id: 'activity-decision', activityType: 'Decision', body: 'Decision recorded after review.', occurredAt: '2026-08-24T01:00:00Z', author: { userId: 'mock-user-c', displayName: 'Mock User C' } }
              ],
              page: 2,
              pageSize: 2,
              totalCount: 3,
              hasMore: false
            })
      });
      return;
    }

    if (path === `/api/projects/${context.projectId}`) {
      parentProjectAttempts += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: context.projectId,
          title: context.projectTitle,
          status: 1,
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          updatedAt: '2026-08-24T00:00:00Z',
          uiPermissions: { canCreateTask: false }
        })
      });
      return;
    }

    if (path === '/api/projects') {
      projectListRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], page: 1, pageSize: 50, totalCount: 0, hasMore: false })
      });
      return;
    }

    await route.fallback();
  });

  return {
    projectListRequests: () => projectListRequests,
    parentProjectRequests: () => parentProjectRequests,
    parentProjectAttempts: () => parentProjectAttempts,
    patchBodies: () => patchBodies,
    activityRequests: () => activityRequests
  };
}

async function installProjectKanbanApi(
  page: Page,
  options: { denySnapshot?: boolean } = {}
) {
  let kanbanGets = 0;
  let taskListGets = 0;
  let moveCount = 0;
  const moveBodies: Record<string, unknown>[] = [];
  const csrfHeaders: string[] = [];
  let authoritativeSnapshot = projectKanbanSnapshot('stage-todo', 7, 3);
  let authoritativeTasks = projectTaskListDtos();

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
      taskListGets += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: authoritativeTasks,
          totalCount: authoritativeTasks.length,
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
        const targetStage = projectKanbanStageId(moveBody['targetWorkflowStageId']);
        authoritativeSnapshot = projectKanbanSnapshot(targetStage, 8, 4);
        if (targetStage === 'stage-done') {
          authoritativeTasks = authoritativeTasks.map((task) => task.id === 'static-task-kanban'
            ? {
                ...task,
                workflowStageId: 'stage-done',
                workflowStageName: 'Complete',
                status: 'Completed',
                stageCategory: 'Done',
                updatedAt: '2026-08-24T10:15:00Z',
                version: 4,
                uiPermissions: { canUpdate: true, rowVersion: '4' }
              }
            : task);
        }
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
    kanbanGetCount: () => kanbanGets,
    taskListGetCount: () => taskListGets
  };
}

function projectTaskListDtos() {
  const common = {
    projectId: 'static-project-kanban',
    priority: 'High',
    primaryAssignee: { userId: 'user-1', displayName: 'Ada' }
  };

  return [
    {
      ...common,
      id: 'static-task-kanban',
      title: 'Canonical card',
      workflowStageId: 'stage-todo',
      workflowStageName: 'Ready for research',
      status: 'NotStarted',
      stageCategory: 'Todo',
      isBlocked: true,
      hasArtifact: true,
      createdAt: '2026-08-20T09:00:00Z',
      updatedAt: '2026-08-23T12:30:00Z',
      version: 3,
      uiPermissions: { canUpdate: true, rowVersion: '3' }
    },
    {
      ...common,
      id: 'static-task-running',
      title: 'Running analysis',
      workflowStageId: 'stage-in-progress',
      workflowStageName: 'Investigating',
      status: 'InProgress',
      stageCategory: 'InProgress',
      isBlocked: false,
      hasArtifact: false,
      createdAt: '2026-08-21T08:15:00Z',
      updatedAt: null,
      version: 2,
      uiPermissions: { canUpdate: true, rowVersion: '2' }
    },
    {
      ...common,
      id: 'static-task-review',
      title: 'Review evidence',
      workflowStageId: 'stage-review',
      workflowStageName: 'Evidence review',
      status: 'WaitingReview',
      stageCategory: 'Review',
      isBlocked: false,
      hasArtifact: true,
      createdAt: '2026-08-19T05:30:00Z',
      updatedAt: '2026-08-24T02:45:00Z',
      version: 7,
      uiPermissions: { canUpdate: true, rowVersion: '7' }
    },
    {
      ...common,
      id: 'static-task-completed',
      title: 'Completed report',
      workflowStageId: 'stage-done',
      workflowStageName: 'Published',
      status: 'Completed',
      stageCategory: 'Done',
      isBlocked: false,
      hasArtifact: true,
      createdAt: '2026-08-18T01:00:00Z',
      updatedAt: '2026-08-22T03:00:00Z',
      version: 5,
      uiPermissions: { canUpdate: true, rowVersion: '5' }
    },
    {
      ...common,
      id: 'static-task-cancelled',
      title: 'Cancelled follow-up',
      workflowStageId: 'stage-cancelled',
      workflowStageName: 'Cancelled',
      status: 'Cancelled',
      stageCategory: 'Cancelled',
      isBlocked: false,
      hasArtifact: false,
      createdAt: '2026-08-17T04:00:00Z',
      updatedAt: '2026-08-21T04:00:00Z',
      version: 4,
      uiPermissions: { canUpdate: true, rowVersion: '4' }
    }
  ];
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
  readonly canOpenProjectCreate?: boolean;
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

interface AnnouncementEditorApiOptions {
  readonly firstPublishFailure?: 'unavailable' | 'audienceAuthorization';
  readonly holdAudienceRefresh?: boolean;
}

interface AnnouncementEditorApiHarness {
  readonly publishRequests: readonly Record<string, unknown>[];
  readonly audienceRefreshRequested: Promise<void>;
  releaseAudienceRefresh(): void;
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

interface CanonicalProjectCreateMockRequest {
  readonly body: Record<string, unknown>;
  readonly rawBody: string;
  readonly idempotencyKey: string;
  readonly csrfToken: string;
}

interface CanonicalProjectCreateActivationHarness {
  readonly createRequests: readonly CanonicalProjectCreateMockRequest[];
  readonly activationRequests: readonly Record<string, unknown>[];
  readonly activationCsrfTokens: readonly string[];
  readonly operationalGetPaths: readonly string[];
  readonly projectListRequests: readonly {
    readonly workspaceId: string | null;
    readonly includesCreatedProject: boolean;
  }[];
  readonly projectGetCount: () => number;
  readonly releaseFirstCreate: () => void;
  readonly allowFirstCreateSuccess: () => void;
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

interface AuditGridFixture {
  readonly id: string;
  readonly createdAt: string;
  readonly action: string;
  readonly actorDisplayName: string;
  readonly targetType: string;
  readonly workspaceLabel: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly result: 'success' | 'denied' | 'failed';
  readonly summary: string;
  readonly requestId: string | null;
}

function auditGridFixtures(count: number): readonly AuditGridFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return {
      id: auditGridFixtureId(index),
      createdAt: `2026-08-25T08:${String(index % 60).padStart(2, '0')}:00Z`,
      action: index % 3 === 0 ? 'audit.detail.read' : index % 3 === 1 ? 'file.download.denied' : 'export.request.failed',
      actorDisplayName: 'Redacted actor',
      targetType: index % 2 === 0 ? 'AuditLog' : 'File',
      workspaceLabel: 'Static Workspace',
      severity: index % 3 === 0 ? 'info' : index % 3 === 1 ? 'warning' : 'critical',
      result: index % 3 === 0 ? 'success' : index % 3 === 1 ? 'denied' : 'failed',
      summary: `Audit row ${number} was opened with safe fields.`,
      requestId: null,
    };
  });
}

function auditGridFixtureId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

async function installAuditGridApi(page: Page, rows: readonly AuditGridFixture[]): Promise<void> {
  await page.route('**/api/admin/audit-grid**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 405 });
      return;
    }

    const url = new URL(request.url());
    if (url.pathname === '/api/admin/audit-grid') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ items: rows, page: 1, pageSize: 100, totalCount: rows.length }),
      });
      return;
    }

    const auditId = url.pathname.slice('/api/admin/audit-grid/'.length);
    const row = rows.find((item) => item.id === auditId);
    await route.fulfill(row
      ? {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(row),
        }
      : {
          status: 404,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ error: { code: 'AuditEventNotFound', message: 'The requested audit event is not available.' } }),
        });
  });
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
      canOpenProjectCreate: workspace.canOpenProjectCreate === true,
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

async function installAnnouncementMobileDetailApi(
  page: Page,
  workspaceId: string,
): Promise<{
  id: string;
  readRequests: { body: Record<string, unknown>; csrfToken: string }[];
}> {
  const id = '38500000-0000-4000-8000-000000000002';
  const readRequests: { body: Record<string, unknown>; csrfToken: string }[] = [];
  let isRead = false;
  const listItem = () => ({
    id,
    workspaceId,
    groupId: null,
    channelId: null,
    title: 'Mobile recipient detail',
    priority: 1,
    isPinned: true,
    requiresReadConfirmation: true,
    isRead,
    publishedAt: '2026-08-25T09:00:00Z',
    expiresAt: '2026-09-01T09:00:00Z',
  });
  const listItems = () => [
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `38500000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
      workspaceId,
      groupId: null,
      channelId: null,
      title: `Mobile list context ${index + 1}`,
      priority: 0,
      isPinned: false,
      requiresReadConfirmation: false,
      isRead: true,
      publishedAt: '2026-08-25T09:00:00Z',
      expiresAt: null,
    })),
    listItem(),
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `38500000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
      workspaceId,
      groupId: null,
      channelId: null,
      title: `Mobile list context ${index + 4}`,
      priority: 0,
      isPinned: false,
      requiresReadConfirmation: false,
      isRead: true,
      publishedAt: '2026-08-25T09:00:00Z',
      expiresAt: null,
    })),
  ];

  await page.route('**/api/security/csrf-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ token: 'csrf-announcement-read', headerName: 'X-CSRF-Token' }),
    });
  });
  await page.route('**/api/announcements**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/announcements/audiences' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify([]),
      });
      return;
    }
    if (pathname === '/api/announcements' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ items: listItems() }),
      });
      return;
    }
    const listedDetail = listItems().find((item) => pathname === `/api/announcements/${item.id}`);
    if (listedDetail && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ...listedDetail,
          body: listedDetail.id === id ? 'A long recipient-facing body. '.repeat(48) : 'List context body.',
          createdAt: '2026-08-25T08:55:00Z',
          updatedAt: '2026-08-25T08:55:00Z',
        }),
      });
      return;
    }
    if (pathname === `/api/announcements/${id}/read` && request.method() === 'POST') {
      readRequests.push({
        body: request.postDataJSON() as Record<string, unknown>,
        csrfToken: request.headers()['x-csrf-token'] ?? '',
      });
      isRead = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ status: 'OK' }),
      });
      return;
    }

    await route.fulfill({ status: 405 });
  });

  return { id, readRequests };
}

async function installAnnouncementEditorApi(
  page: Page,
  options: AnnouncementEditorApiOptions = {}
): Promise<AnnouncementEditorApiHarness> {
  const workspaceId = '38000000-0000-4000-8000-000000000001';
  const publishRequests: Record<string, unknown>[] = [];
  let audienceRequestCount = 0;
  let releaseAudienceRefresh!: () => void;
  let notifyAudienceRefreshRequested!: () => void;
  const audienceRefreshGate = new Promise<void>((resolve) => {
    releaseAudienceRefresh = resolve;
  });
  const audienceRefreshRequested = new Promise<void>((resolve) => {
    notifyAudienceRefreshRequested = resolve;
  });

  await page.route('**/api/announcements', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ items: [] })
      });
      return;
    }

    if (request.method() !== 'POST') {
      await route.fulfill({ status: 405 });
      return;
    }

    publishRequests.push(request.postDataJSON() as Record<string, unknown>);
    if (publishRequests.length === 1) {
      await route.fulfill({
        status: options.firstPublishFailure === 'audienceAuthorization' ? 400 : 503,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          error: options.firstPublishFailure === 'audienceAuthorization'
            ? 'Announcement audience is not authorized.'
            : 'internal upstream detail'
        })
      });
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        id: '38000000-0000-4000-8000-000000000002',
        workspaceId,
        groupId: null,
        channelId: null,
        title: 'Accessible announcement',
        body: 'The draft must remain available after an API failure.',
        priority: 0,
        requiresReadConfirmation: false,
        isRead: false,
        publishedAt: '2026-08-24T10:00:00Z'
      })
    });
  });

  await page.route('**/api/announcements/audiences', async (route) => {
    audienceRequestCount += 1;
    if (audienceRequestCount > 1 && options.holdAudienceRefresh) {
      notifyAudienceRefreshRequested();
      await audienceRefreshGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify([])
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify([
        {
          key: 'workspace:' + workspaceId,
          scopeType: 'workspace',
          workspaceId,
          groupId: null,
          channelId: null,
          displayName: 'Announcement evidence workspace',
          estimatedRecipientCount: 24
        }
      ])
    });
  });

  return {
    publishRequests,
    audienceRefreshRequested,
    releaseAudienceRefresh
  };
}

async function installCanonicalProjectCreateActivationApi(
  page: Page,
  scope: { workspaceId: string; projectId: string; groupId: string }
): Promise<CanonicalProjectCreateActivationHarness> {
  const ownerUserId = '40900000-0000-4000-8000-000000000004';
  const createRequests: CanonicalProjectCreateMockRequest[] = [];
  const activationRequests: Record<string, unknown>[] = [];
  const activationCsrfTokens: string[] = [];
  const operationalGetPaths: string[] = [];
  const projectListRequests: {
    workspaceId: string | null;
    includesCreatedProject: boolean;
  }[] = [];
  let releaseFirstCreate!: () => void;
  const firstCreateGate = new Promise<void>((resolve) => {
    releaseFirstCreate = resolve;
  });
  let firstCreateShouldFail = true;
  let projectGets = 0;
  let created = false;
  let activated = false;

  const projectDto = () => ({
    id: scope.projectId,
    workspaceId: scope.workspaceId,
    groupId: scope.groupId,
    ownerUserId,
    title: 'U-22 Canonical Project',
    description: 'Canonical create and activation browser evidence.',
    status: activated ? 1 : 0,
    visibility: 1,
    activationState: activated ? 2 : 1,
    activatedAtUtc: activated ? '2026-08-24T05:05:00Z' : null,
    activationVersion: activated ? 1 : null,
    versionNo: activated ? 2 : 1,
    startDate: '2026-09-10',
    endDate: '2026-09-20',
    createdAt: '2026-08-24T05:00:00Z',
    updatedAt: activated ? '2026-08-24T05:05:00Z' : null,
    uiPermissions: {
      canCreateTask: activated,
      canActivate: !activated
    }
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (
      path === `/api/workspaces/${scope.workspaceId}/projects/create-options` &&
      method === 'GET'
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          requestId: 'project-options-200',
          data: {
            workspaceId: scope.workspaceId,
            canCreateUngrouped: false,
            allowedVisibilities: [1],
            groups: [{ id: scope.groupId, name: 'Evidence Review Group' }]
          },
          warnings: []
        })
      });
      return;
    }

    if (path === `/api/workspaces/${scope.workspaceId}/projects` && method === 'POST') {
      const recorded: CanonicalProjectCreateMockRequest = {
        body: request.postDataJSON() as Record<string, unknown>,
        rawBody: request.postData() ?? '',
        idempotencyKey: request.headers()['idempotency-key'] ?? '',
        csrfToken: request.headers()['x-csrf-token'] ?? ''
      };
      createRequests.push(recorded);
      if (createRequests.length === 1 && firstCreateShouldFail) {
        await firstCreateGate;
        if (firstCreateShouldFail) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({
              requestId: 'project-create-503',
              error: {
                code: 'DependencyUnavailable',
                message: 'Project creation outcome is temporarily unavailable.',
                target: 'project',
                details: [],
                redactionApplied: false
              },
              traceId: 'project-create-503',
              status: 503
            })
          });
          return;
        }
      }

      created = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          requestId: 'project-create-201',
          data: {
            id: scope.projectId,
            workspaceId: scope.workspaceId,
            groupId: scope.groupId,
            ownerUserId,
            title: 'U-22 Canonical Project',
            description: 'Canonical create and activation browser evidence.',
            status: 0,
            visibility: 1,
            activationState: 1,
            startDate: '2026-09-10',
            endDate: '2026-09-20',
            versionNo: 1,
            createdAt: '2026-08-24T05:00:00Z'
          },
          warnings: []
        })
      });
      return;
    }

    if (path === '/api/projects' && method === 'GET') {
      expect(url.searchParams.get('workspaceId')).toBe(scope.workspaceId);
      projectListRequests.push({
        workspaceId: url.searchParams.get('workspaceId'),
        includesCreatedProject: created
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          items: created ? [projectDto()] : [],
          page: 1,
          pageSize: 50,
          totalCount: created ? 1 : 0,
          hasMore: false
        })
      });
      return;
    }

    if (path === `/api/projects/${scope.projectId}` && method === 'GET') {
      projectGets += 1;
      await route.fulfill({
        status: created ? 200 : 404,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(created ? projectDto() : { title: 'Not Found', status: 404 })
      });
      return;
    }

    if (path === `/api/projects/${scope.projectId}/activate` && method === 'POST') {
      activationRequests.push(request.postDataJSON() as Record<string, unknown>);
      activationCsrfTokens.push(request.headers()['x-csrf-token'] ?? '');
      activated = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          requestId: 'project-activate-200',
          data: { projectId: scope.projectId },
          warnings: []
        })
      });
      return;
    }

    const operationalSuffix = path.startsWith(`/api/projects/${scope.projectId}/`)
      ? path.slice(`/api/projects/${scope.projectId}`.length)
      : null;
    if (
      method === 'GET' &&
      operationalSuffix !== null &&
      ['/tasks', '/kanban', '/gantt', '/workload', '/members'].includes(operationalSuffix)
    ) {
      operationalGetPaths.push(operationalSuffix);
      if (operationalSuffix === '/tasks') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], page: 1, pageSize: 50, totalCount: 0, hasMore: false })
        });
        return;
      }
      if (operationalSuffix === '/kanban') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(emptyCanonicalKanban(scope.projectId))
        });
        return;
      }
      if (operationalSuffix === '/gantt') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(emptyCanonicalGantt(scope.projectId))
        });
        return;
      }
      if (operationalSuffix === '/workload') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ members: [] })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ userId: ownerUserId, displayName: 'Mock User A', role: 'Owner' }])
      });
      return;
    }

    await route.fallback();
  });

  return {
    createRequests,
    activationRequests,
    activationCsrfTokens,
    operationalGetPaths,
    projectListRequests,
    projectGetCount: () => projectGets,
    releaseFirstCreate,
    allowFirstCreateSuccess: () => {
      firstCreateShouldFail = false;
      releaseFirstCreate();
    }
  };
}

function emptyCanonicalKanban(projectId: string) {
  return {
    board: {
      projectId,
      version: 1,
      timeZone: 'UTC',
      defaultSwimlane: 0,
      selectedSwimlane: 0,
      supportedSwimlanes: [0, 1, 2, 3, 4],
      supportedFilters: ['includeOlderCompleted'],
      includesOlderCompleted: false,
      doneWindowDays: 30,
      totalAuthorizedCardCount: 0,
      isTruncated: false,
      uiPermissions: { canConfigure: true },
      warnings: []
    },
    columns: [
      {
        workflowStageId: '40900000-0000-4000-8000-000000000010',
        displayName: 'Todo',
        category: 1,
        displayOrder: 1000,
        wipWarningLimit: null,
        currentAuthorizedCardCount: 0,
        hasWipWarning: false,
        uiPermissions: { canConfigure: true }
      },
      {
        workflowStageId: '40900000-0000-4000-8000-000000000011',
        displayName: 'Done',
        category: 4,
        displayOrder: 2000,
        wipWarningLimit: null,
        currentAuthorizedCardCount: 0,
        hasWipWarning: false,
        uiPermissions: { canConfigure: true }
      }
    ],
    cards: []
  };
}

function emptyCanonicalGantt(projectId: string) {
  const permissions = {
    canEditSchedule: true,
    canEditProgress: true,
    canManageDependencies: true,
    canClearSchedule: true,
    canOpen: true
  };
  return {
    projectId,
    projectTitle: 'U-22 Canonical Project',
    projectVersion: 2,
    workflowVersion: 1,
    calendarVersion: null,
    calendar: {
      timeZone: 'UTC',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      holidaysAvailable: false,
      limitations: []
    },
    scheduledItems: [],
    unscheduledItems: [],
    milestones: [],
    dependencies: [],
    warnings: [],
    permissions,
    maximumItems: 500,
    totalItems: 0
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
