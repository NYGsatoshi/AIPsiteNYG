import { expect, type Page, type Response as PlaywrightResponse, test } from '@playwright/test';

const smokeEmail = process.env.AIP_BROWSER_SMOKE_EMAIL ?? '';
const smokePassword = process.env.AIP_BROWSER_SMOKE_PASSWORD ?? '';

const smokeWorkspaceName = 'Browser Smoke Workspace';
const smokeAnnouncementTitle = 'Browser smoke announcement';
const smokeProjectTitle = 'Browser Smoke Project';
const smokeTaskTitle = 'Browser smoke task';
const smokeRecipientName = 'Browser Smoke Recipient';
const smokeTaskLabelName = 'Browser smoke label';
const smokeTaskFileName = 'browser-smoke-task.txt';

test.describe('MVP0 real backend browser smoke', () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    if (process.env.AIP_REAL_BACKEND_SMOKE !== '1') {
      throw new Error('This real-backend smoke requires AIP_REAL_BACKEND_SMOKE=1. Use `npm run test:ui:real-backend`; do not run it against the static Angular mock server.');
    }

    const baseURL = process.env.PLAYWRIGHT_BASE_URL;
    if (!baseURL || /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost):4173(?:\/|$)/i.test(baseURL)) {
      throw new Error('The real-backend smoke requires a non-static PLAYWRIGHT_BASE_URL. Use `npm run test:ui:real-backend`, which runs Playwright inside Compose at http://app:8080.');
    }

    if (!smokeEmail || !smokeEmail.toLowerCase().endsWith('@example.test') || !smokePassword) {
      throw new Error('The real-backend smoke requires defined synthetic @example.test seed credentials. Use `npm run test:ui:real-backend`.');
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'Real-backend smoke runs once against the desktop browser project because it uses a shared seeded backend account.'
    );
  });

  test('exercises mandatory authenticated MVP0 flows through ASP.NET Core backend', async ({ page }, testInfo) => {
    const evidence: SmokeEvidence = {
      baseURL: String(testInfo.project.use.baseURL ?? ''),
      email: smokeEmail,
      steps: [],
      pageErrors: [],
      consoleErrors: [],
      failedApiResponses: []
    };

    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        evidence.consoleErrors.push(message.text());
      }
    });
    page.on('response', (response) => recordFailedApiResponse(response, evidence));

    try {
      const hubNegotiate = page.waitForRequest((request) => new URL(request.url()).pathname === '/hubs/app/negotiate');
      await loginAndVerifySession(page, evidence);
      await verifyRealtimeRuntimeConfig(page, evidence);
      await hubNegotiate;
      await verifyRealtimeTransportReconnect(page, evidence);
      await assertCsrfRejectsMissingToken(page, evidence);
      await openWorkspaces(page, evidence);
      await createDirectMessageAndVerifyPersistence(page, evidence);
      await openAnnouncementDetail(page, evidence);
      await openProjectTaskDetail(page, evidence);
      await submitInvalidPasswordChange(page, evidence);
      await logoutAndVerifyAccessRevoked(page, evidence);

      expect(evidence.pageErrors, 'browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(evidence);
      expectUnexpectedApiFailures(evidence);
    } finally {
      await testInfo.attach('real-backend-smoke-evidence.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json'
      });
    }
  });

  test('keeps authenticated HTTP requests available when the Hub cannot connect', async ({ page }, testInfo) => {
    await page.route('**/hubs/app/**', (route) => route.abort());
    const evidence: SmokeEvidence = { baseURL: String(testInfo.project.use.baseURL ?? ''), email: smokeEmail, steps: [], pageErrors: [], consoleErrors: [], failedApiResponses: [] };

    await loginAndVerifySession(page, evidence);
    await expect(page.getByTestId('realtime-connection-state')).toContainText('Realtime updates are delayed');
    await recordFetchJson(page, evidence, 'degraded-http-auth-status', '/api/auth/status', {
      validate: (body) => body && typeof body === 'object' && (body as Record<string, unknown>).isAuthenticated === true
    });
  });

  test('TASK-V1-PR03C uses the real backend for task detail, mutations, revocation, and File grant reauthorization', async ({ page }, testInfo) => {
    const evidence: SmokeEvidence = {
      baseURL: String(testInfo.project.use.baseURL ?? ''), email: smokeEmail, steps: [], pageErrors: [], consoleErrors: [], failedApiResponses: []
    };
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
    page.on('response', (response) => recordFailedApiResponse(response, evidence));

    try {
      await loginAndVerifySession(page, evidence);
      await openPr03cTaskDetail(page, evidence);
      const taskId = evidence.taskId!;
      const projectId = evidence.projectId!;
      const workspaceId = evidence.workspaceId!;
      const userId = evidence.userId!;

      const detail = await recordFetchJson(page, evidence, 'pr03c-task-detail-aggregate', `/api/tasks/${taskId}`, {
        validate: (body) => isPr03cTaskDetail(body, taskId, projectId)
      });
      const detailRecord = detail as Record<string, any>;
      const attachmentId = String(detailRecord.files.items[0].id);
      expect(JSON.stringify(detail), 'task detail must not disclose storage or grant secrets').not.toMatch(/storageKey|filePath|tokenHash|signedUrl|internal\/task-file/i);

      await expect(page.getByTestId('task-detail-version')).not.toHaveText('0');
      await expect(page.getByRole('heading', { name: 'Subtasks' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Checklist' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Watch' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
      await expect(page.getByText(smokeTaskLabelName, { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Not watching', { exact: true })).toBeVisible();
      await expect(page.getByText(smokeTaskFileName, { exact: true })).toBeVisible();
      await expect(page.getByText('Access: Available', { exact: true })).toBeVisible();

      const grant = await requestWithCsrf(page, 'POST', `/api/attachments/${attachmentId}/download-grants`, { purpose: 'pr03c-acceptance' });
      evidence.steps.push({ name: 'pr03c-file-grant-before-revocation', method: 'POST', path: `/api/attachments/${attachmentId}/download-grants`, status: grant.status, bodyPreview: '[redacted]' });
      expect(grant.status, 'authorized actor receives a fresh Attachment download grant').toBe(200);

      const checklistText = `PR03C checklist ${Date.now()}`;
      const checklistResponse = waitForApiResponse(page, 'POST', `/api/tasks/${taskId}/checklist`);
      await page.locator('#checklist-text').fill(checklistText);
      await page.getByRole('button', { name: 'Add checklist item' }).click();
      await recordOkJson(await checklistResponse, evidence, 'pr03c-checklist-create', (body) => hasString(body, 'id') && hasStringValue(body, 'text', checklistText));
      await expect(page.getByText(checklistText, { exact: true })).toBeVisible();
      const checklistSection = page.locator('section[aria-labelledby="checklist-heading"]');
      const checklistDelete = waitForApiResponse(page, 'DELETE', new RegExp(`/api/tasks/${taskId}/checklist/`));
      await checklistSection.getByRole('button', { name: 'Delete' }).click();
      await recordOkJson(await checklistDelete, evidence, 'pr03c-checklist-delete', (body) => body && typeof body === 'object');
      await expect(page.getByText(checklistText, { exact: true })).toHaveCount(0);

      const mentionResponse = waitForApiResponse(page, 'GET', new RegExp(`/api/tasks/${taskId}/mention-candidates$`));
      await page.locator('#task-comment-body').fill('@Browser');
      await recordOkJson(await mentionResponse, evidence, 'pr03c-mention-candidates', (body) => Array.isArray(body) && body.some((candidate: unknown) => hasStringValue(candidate, 'displayName', smokeRecipientName)));
      await page.getByRole('button', { name: `@${smokeRecipientName}` }).click();
      const commentResponse = waitForApiResponse(page, 'POST', `/api/tasks/${taskId}/comments`);
      await page.getByRole('button', { name: 'Post comment' }).click();
      const comment = await recordOkJson(await commentResponse, evidence, 'pr03c-comment-create', (body) => hasString(body, 'id') && Array.isArray((body as Record<string, unknown>).mentions));
      const commentId = String((comment as Record<string, unknown>).id);
      await expect(page.getByText(`@${smokeRecipientName}`, { exact: true })).toBeVisible();
      const commentDelete = waitForApiResponse(page, 'DELETE', `/api/task-comments/${commentId}`);
      await page.locator('section[aria-labelledby="comments-heading"]').getByRole('button', { name: 'Delete' }).click();
      await recordOkJson(await commentDelete, evidence, 'pr03c-comment-delete', (body) => body && typeof body === 'object');

      const mismatchProjectId = '00000000-0000-0000-0000-000000000001';
      await page.goto(`/app/projects/${mismatchProjectId}/tasks/${taskId}`);
      await expect(page.getByText('Task not found', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: smokeTaskTitle })).toHaveCount(0);
      await expect(page.getByText(smokeTaskLabelName, { exact: true })).toHaveCount(0);
      await expect(page.getByText(smokeTaskFileName, { exact: true })).toHaveCount(0);

      await page.goto(`/app/projects/${projectId}/tasks/${taskId}`);
      await expect(page.getByRole('heading', { name: smokeTaskTitle })).toBeVisible();
      const removeMembership = await requestWithCsrf(page, 'DELETE', `/api/workspaces/${workspaceId}/members/${userId}`);
      evidence.steps.push({ name: 'pr03c-workspace-membership-revoked', method: 'DELETE', path: `/api/workspaces/${workspaceId}/members/${userId}`, status: removeMembership.status });
      expect(removeMembership.status, 'test setup revokes active Workspace access through the real backend').toBe(200);

      await page.reload();
      await expect(page.getByRole('heading', { name: smokeTaskTitle })).toHaveCount(0);
      await expect(page.getByText(smokeTaskLabelName, { exact: true })).toHaveCount(0);
      await expect(page.getByText(smokeTaskFileName, { exact: true })).toHaveCount(0);
      await expect(page.locator('#task-comment-body')).toHaveCount(0);

      const deniedTask = await fetchFromPage(page, `/api/tasks/${taskId}`);
      evidence.steps.push({ name: 'pr03c-task-denied-after-revocation', method: 'GET', path: `/api/tasks/${taskId}`, status: deniedTask.status, bodyPreview: preview(deniedTask.text) });
      expect(deniedTask.status, 'revoked actor must receive the canonical task safe-not-found response').toBe(404);
      expectCanonicalDenial(deniedTask.text, 'TASK_NOT_FOUND');

      const deniedGrant = await requestWithCsrf(page, 'POST', `/api/attachments/${attachmentId}/download-grants`, { purpose: 'pr03c-after-revocation' });
      evidence.steps.push({ name: 'pr03c-file-grant-denied-after-revocation', method: 'POST', path: `/api/attachments/${attachmentId}/download-grants`, status: deniedGrant.status, bodyPreview: preview(deniedGrant.text) });
      expect(deniedGrant.status, 'revoked actor must receive the canonical grant safe-not-found response').toBe(404);
      expectCanonicalDenial(deniedGrant.text, 'FILE_DOWNLOAD_GRANT_NOT_FOUND');
      expect(deniedGrant.text, 'denial must not disclose the protected File metadata').not.toMatch(/browser-smoke-task|storageKey|filePath|tokenHash|internal\/task-file/i);

      expect(evidence.pageErrors, 'browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(evidence);
      expectUnexpectedApiFailures(evidence);
    } finally {
      await testInfo.attach('task-v1-pr03c-real-backend-evidence.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    }
  });
});

async function loginAndVerifySession(page: Page, evidence: SmokeEvidence) {
  await page.goto('/app/login');
  await expect(page.getByTestId('login-page')).toBeVisible();
  await recordFetchJson(page, evidence, 'csrf-token', '/api/security/csrf-token', {
    sensitive: true,
    validate: (body) => hasString(body, 'token') && hasString(body, 'headerName')
  });

  await page.getByTestId('login-email').fill(smokeEmail);
  await page.getByTestId('login-password').fill(smokePassword);

  const [loginResponse] = await Promise.all([
    waitForApiResponse(page, 'POST', '/api/auth/login'),
    page.getByTestId('login-submit').click()
  ]);

  const loginBody = await recordOkJson(loginResponse, evidence, 'login', (body) =>
    hasString(body, 'userId') &&
    hasStringValue(body, 'email', smokeEmail) &&
    Array.isArray((body as Record<string, unknown>).workspaces)
  );
  evidence.userId = String(loginBody.userId);

  await expect(page).toHaveURL(/\/app\/workspaces$/);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('nav-projects').first()).toBeVisible();
  await expect(page.getByTestId('nav-my-tasks').first()).toBeVisible();

  await recordFetchJson(page, evidence, 'auth-me', '/api/auth/me', {
    validate: (body) =>
      hasStringValue(body, 'userId', evidence.userId ?? '') &&
      hasStringValue(body, 'email', smokeEmail) &&
      Array.isArray((body as Record<string, unknown>).workspaces) &&
      hasCapability(body, 'projects:view')
  });
}

async function verifyRealtimeTransportReconnect(page: Page, evidence: SmokeEvidence) {
  const indicator = page.getByTestId('realtime-connection-state');
  await expect(indicator).toContainText('Realtime updates connected.', { timeout: 30_000 });

  await page.context().setOffline(true);
  await expect(indicator).toContainText('Offline.', { timeout: 10_000 });
  evidence.steps.push({ name: 'realtime-forced-disconnect', status: 0 });

  await page.context().setOffline(false);
  await expect(indicator).toContainText('Realtime updates connected.', { timeout: 30_000 });
  evidence.steps.push({ name: 'realtime-reconnected-and-reauthorized', status: 200 });
}

async function assertCsrfRejectsMissingToken(page: Page, evidence: SmokeEvidence) {
  const probe = await page.evaluate(async () => {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'wrong-current-password',
        newPassword: 'E2eSmoke!99999'
      })
    });

    return {
      status: response.status,
      text: await response.text()
    };
  });

  evidence.steps.push({
    name: 'csrf-missing-token-rejected',
    method: 'POST',
    path: '/api/auth/change-password',
    status: probe.status,
    bodyPreview: preview(probe.text)
  });
  expect(probe.status, 'unsafe request without CSRF token must be rejected before application validation').toBe(403);
  expect(probe.text, 'CSRF rejection body').toContain('CSRF');
}

async function createDirectMessageAndVerifyPersistence(page: Page, evidence: SmokeEvidence) {
  await page.getByRole('link', { name: 'Messages' }).first().click();
  await expect(page).toHaveURL(/\/app\/messages$/);
  await expect(page.getByTestId('messages-page')).toBeVisible();
  await expect(page.getByTestId('new-message-button')).toBeVisible();

  await page.getByTestId('new-message-button').click();
  await expect(page.getByTestId('new-message-dialog')).toBeVisible();

  const [recipientsResponse] = await Promise.all([
    waitForApiResponse(page, 'GET', '/api/conversations/recipients'),
    page.getByTestId('recipient-search').fill('Recipient')
  ]);
  const recipientsBody = await recordOkJson(recipientsResponse, evidence, 'message-recipients', (body) =>
    Array.isArray(body) && body.some((item: unknown) => hasStringValue(item, 'displayName', smokeRecipientName))
  );
  const recipient = recipientsBody.find((item: Record<string, unknown>) => item.displayName === smokeRecipientName);
  expect(recipient, 'seeded message recipient').toBeTruthy();

  await expect(page.getByTestId('recipient-option').filter({ hasText: smokeRecipientName })).toBeVisible();
  await page.getByTestId('recipient-option').filter({ hasText: smokeRecipientName }).click();

  const [createResponse] = await Promise.all([
    waitForApiResponse(page, 'POST', '/api/conversations/direct'),
    page.getByTestId('create-conversation-submit').click()
  ]);
  const createBody = await recordOkJson(createResponse, evidence, 'message-conversation-create', (body) =>
    hasString(body, 'id') &&
    hasStringValue(body, 'title', smokeRecipientName) &&
    hasStringValue(body, 'type', 'DirectMessage')
  );
  evidence.conversationId = String(createBody.id);

  await expect(page).toHaveURL(new RegExp(`/app/dm/${evidence.conversationId}$`));
  await expect(page.getByTestId('dm-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: smokeRecipientName })).toBeVisible();

  const messageBody = `Real backend DM ${Date.now()}`;
  evidence.messageBody = messageBody;
  await page.getByTestId('message-draft').fill(messageBody);

  const [messageResponse] = await Promise.all([
    waitForApiResponse(page, 'POST', `/api/conversations/${evidence.conversationId}/messages`),
    page.getByTestId('send-message').click()
  ]);
  const messageResponseBody = await recordOkJson(messageResponse, evidence, 'message-send', (body) =>
    hasString(body, 'id') &&
    hasStringValue(body, 'conversationId', evidence.conversationId ?? '') &&
    hasStringValue(body, 'body', messageBody)
  );
  evidence.messageId = String(messageResponseBody.id);

  await expect(page.getByTestId('confirmed-message').filter({ hasText: messageBody })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('dm-page')).toBeVisible();
  await expect(page.getByTestId('confirmed-message').filter({ hasText: messageBody })).toBeVisible();

  await recordFetchJson(page, evidence, 'message-list-after-reload', `/api/conversations/${evidence.conversationId}/messages`, {
    validate: (body) =>
      isPagedResponse(body) &&
      body.items.some((item: unknown) =>
        hasStringValue(item, 'id', evidence.messageId ?? '') &&
        hasStringValue(item, 'body', messageBody)
      )
  });
}

async function openWorkspaces(page: Page, evidence: SmokeEvidence) {
  await page.getByRole('link', { name: 'Workspaces' }).first().click();
  await expect(page).toHaveURL(/\/app\/workspaces$/);
  await expect(page.getByTestId('workspace-dashboard')).toBeVisible();

  await recordFetchJson(page, evidence, 'workspaces-list', '/api/workspaces', {
    validate: (body) =>
      Array.isArray(body) && body.some((item: unknown) => hasStringValue(item, 'name', smokeWorkspaceName))
  });
  await expect(page.getByTestId('workspace-card').filter({ hasText: smokeWorkspaceName }).first()).toBeVisible();
}

async function openAnnouncementDetail(page: Page, evidence: SmokeEvidence) {
  await page.getByRole('link', { name: 'Announcements' }).first().click();
  await expect(page).toHaveURL(/\/app\/announcements$/);
  await expect(page.getByTestId('announcements-page')).toBeVisible();

  const listBody = await recordFetchJson(page, evidence, 'announcements-list', '/api/announcements', {
    validate: (body) =>
      isPagedResponse(body) &&
      body.items.some((item: unknown) => hasStringValue(item, 'title', smokeAnnouncementTitle))
  });
  const announcement = listBody.items.find((item: Record<string, unknown>) => item.title === smokeAnnouncementTitle);
  expect(announcement, 'seeded announcement record').toBeTruthy();
  evidence.announcementId = String(announcement!.id);

  const announcementItem = page.getByTestId('announcement-list-item').filter({ hasText: smokeAnnouncementTitle }).first();
  await expect(announcementItem).toBeVisible();
  await announcementItem.click();

  await expect(page.getByTestId('announcement-detail-title')).toContainText(smokeAnnouncementTitle);
  await expect(page.getByTestId('announcement-body-text')).toContainText('Synthetic announcement body');

  await recordFetchJson(page, evidence, 'announcement-detail', `/api/announcements/${evidence.announcementId}`, {
    validate: (body) =>
      hasStringValue(body, 'id', evidence.announcementId ?? '') &&
      hasStringValue(body, 'title', smokeAnnouncementTitle) &&
      hasString(body, 'body')
  });
}

async function openProjectTaskDetail(page: Page, evidence: SmokeEvidence) {
  await page.getByRole('link', { name: 'Projects' }).first().click();
  await expect(page).toHaveURL(/\/app\/projects$/);
  await expect(page.getByTestId('projects-overview-page')).toBeVisible();

  const projectsBody = await recordFetchJson(page, evidence, 'projects-list', '/api/projects', {
    validate: (body) =>
      isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', smokeProjectTitle))
  });
  const project = projectsBody.items.find((item: Record<string, unknown>) => item.title === smokeProjectTitle);
  expect(project, 'seeded project record').toBeTruthy();
  evidence.projectId = String(project!.id);
  await expect(page.getByTestId('project-summary-card').filter({ hasText: smokeProjectTitle }).first()).toBeVisible();

  const tasksBody = await recordFetchJson(page, evidence, 'project-tasks', `/api/projects/${evidence.projectId}/tasks`, {
    validate: (body) =>
      isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', smokeTaskTitle))
  });
  const task = tasksBody.items.find((item: Record<string, unknown>) => item.title === smokeTaskTitle);
  expect(task, 'seeded task record').toBeTruthy();
  evidence.taskId = String(task!.id);

  // The projects overview intentionally lists project summaries only. Follow
  // the real project navigation and select its Task list before asserting a
  // task-grid row; the API assertion above remains the direct list contract.
  const projectCard = page.getByTestId('project-summary-card').filter({ hasText: smokeProjectTitle }).first();
  await projectCard.getByRole('link', { name: `Open ${smokeProjectTitle}` }).click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${evidence.projectId}$`));
  await expect(page.getByTestId('project-detail-page')).toBeVisible();
  await page.getByRole('tab', { name: 'List', exact: true }).click();

  const taskRow = page.locator('[role="row"]').filter({ hasText: smokeTaskTitle }).first();
  await expect(taskRow).toBeVisible();
  await taskRow.getByTestId('task-action-openDetail').click();

  await expect(page.getByTestId('task-detail-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: smokeTaskTitle })).toBeVisible();
  await recordFetchJson(page, evidence, 'task-detail', `/api/tasks/${evidence.taskId}`, {
    validate: (body) =>
      isPr03cTaskDetail(body, evidence.taskId ?? '', evidence.projectId ?? '')
  });

  await openMyTasksFromNavigation(page, evidence);
}

async function openPr03cTaskDetail(page: Page, evidence: SmokeEvidence) {
  const projectsBody = await recordFetchJson(page, evidence, 'pr03c-projects-list', '/api/projects', {
    validate: (body) => isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', smokeProjectTitle))
  });
  const project = projectsBody.items.find((item: Record<string, unknown>) => item.title === smokeProjectTitle);
  expect(project, 'PR03C seeded project').toBeTruthy();
  evidence.projectId = String(project!.id);

  const tasksBody = await recordFetchJson(page, evidence, 'pr03c-project-tasks', `/api/projects/${evidence.projectId}/tasks`, {
    validate: (body) => isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', smokeTaskTitle))
  });
  const task = tasksBody.items.find((item: Record<string, unknown>) => item.title === smokeTaskTitle);
  expect(task, 'PR03C seeded task').toBeTruthy();
  evidence.taskId = String(task!.id);

  const detail = await recordFetchJson(page, evidence, 'pr03c-task-detail-contract', `/api/tasks/${evidence.taskId}`, {
    validate: (body) => isPr03cTaskDetail(body, evidence.taskId ?? '', evidence.projectId ?? '')
  });
  evidence.workspaceId = String((detail as Record<string, any>).task.workspaceId);
  expect(evidence.workspaceId, 'task workspaceId is part of the canonical Task DTO').toMatch(/^[0-9a-f-]{36}$/i);

  await page.goto(`/app/projects/${evidence.projectId}/tasks/${evidence.taskId}`);
  await expect(page.getByTestId('task-detail-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: smokeTaskTitle })).toBeVisible();
}

async function openMyTasksFromNavigation(page: Page, evidence: SmokeEvidence) {
  let blockedProjectListRequests = 0;
  await page.route('**/api/projects', async (route) => {
    blockedProjectListRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Project list intentionally blocked during My Tasks independence probe.' })
    });
  });

  const [myTasksResponse] = await Promise.all([
    waitForApiResponse(page, 'GET', '/api/me/tasks'),
    page.getByTestId('nav-my-tasks').first().click()
  ]);
  await expect(page).toHaveURL(/\/app\/tasks$/);
  await expect(page.getByTestId('my-tasks-page')).toBeVisible();
  await expect(page.getByTestId('projects-load-error')).toHaveCount(0);

  const myTasksBody = await recordOkJson(myTasksResponse, evidence, 'my-tasks-list-ui-request', (body) =>
    isPagedResponse(body) &&
    body.items.some((item: unknown) =>
      hasStringValue(item, 'taskId', evidence.taskId ?? '') &&
      hasStringValue(item, 'projectId', evidence.projectId ?? '') &&
      hasStringValue(item, 'projectTitle', smokeProjectTitle) &&
      hasStringValue(item, 'title', smokeTaskTitle)
    )
  );
  const assignedTask = myTasksBody.items.find((item: Record<string, unknown>) => item.title === smokeTaskTitle);
  expect(assignedTask, 'seeded assigned My Tasks row').toBeTruthy();
  expect(blockedProjectListRequests, 'My Tasks must not request /api/projects while loading').toBe(0);
  evidence.steps.push({
    name: 'my-tasks-independent-from-project-list',
    method: 'GET',
    path: '/api/projects',
    status: blockedProjectListRequests
  });

  const taskRow = page.locator('[role="row"]').filter({ hasText: smokeTaskTitle }).first();
  await expect(taskRow).toBeVisible();
  await taskRow.getByTestId('task-action-openDetail').click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${evidence.projectId}/tasks/${evidence.taskId}$`));
  await expect(page.getByTestId('task-detail-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: smokeTaskTitle })).toBeVisible();

  await page.unroute('**/api/projects');
}

async function submitInvalidPasswordChange(page: Page, evidence: SmokeEvidence) {
  await page.getByRole('link', { name: 'Account' }).first().click();
  await expect(page).toHaveURL(/\/app\/account$/);
  await expect(page.getByTestId('account-page')).toBeVisible();
  await expect(page.getByTestId('password-panel')).toBeVisible();

  await page.getByTestId('current-password').fill('wrong-current-password');
  await page.getByTestId('new-password').fill('E2eSmoke!99999');
  await page.getByTestId('confirm-new-password').fill('E2eSmoke!99999');

  const [passwordResponse] = await Promise.all([
    waitForApiResponse(page, 'POST', '/api/auth/change-password'),
    page.getByRole('button', { name: 'Change password' }).click()
  ]);
  await recordFailureJson(passwordResponse, evidence, 'password-change-validation-failure', 400, (body) =>
    hasString(body, 'error')
  );
  await expect(page.getByTestId('password-change-failure')).toBeVisible();
  await expect(page.getByTestId('password-change-success')).toHaveCount(0);
}

async function logoutAndVerifyAccessRevoked(page: Page, evidence: SmokeEvidence) {
  const [logoutResponse] = await Promise.all([
    waitForApiResponse(page, 'POST', '/api/auth/logout'),
    page.getByTestId('logout-action').click()
  ]);
  await recordOkJson(logoutResponse, evidence, 'logout', (body) => hasStringValue(body, 'status', 'OK'));

  await expect(page).toHaveURL(/\/app\/login$/);
  await expect(page.getByTestId('login-page')).toBeVisible();
  await expect(page.getByTestId('app-shell')).toHaveCount(0);

  const meProbe = await fetchFromPage(page, '/api/auth/me');
  evidence.steps.push({
    name: 'post-logout-auth-me',
    method: 'GET',
    path: '/api/auth/me',
    status: meProbe.status,
    bodyPreview: preview(meProbe.text)
  });
  expect(meProbe.status, 'protected current-user API must reject after logout').toBe(401);

  const statusProbe = await fetchJsonFromPage(page, '/api/auth/status');
  evidence.steps.push({
    name: 'post-logout-auth-status',
    method: 'GET',
    path: '/api/auth/status',
    status: statusProbe.status,
    body: statusProbe.body
  });
  expect(statusProbe.status).toBe(200);
  expect(statusProbe.body.isAuthenticated).toBe(false);

  const projectsProbe = await fetchFromPage(page, '/api/projects');
  evidence.steps.push({
    name: 'post-logout-protected-projects',
    method: 'GET',
    path: '/api/projects',
    status: projectsProbe.status,
    bodyPreview: preview(projectsProbe.text)
  });
  expect(projectsProbe.status, 'protected project API must reject after logout').toBe(401);

  await page.goto('/app/projects');
  await expect(page).toHaveURL(/\/app\/login$/);
  await expect(page.getByTestId('projects-overview-page')).toHaveCount(0);
}

function waitForApiResponse(page: Page, method: string, path: string | RegExp): Promise<PlaywrightResponse> {
  return page.waitForResponse((response) => {
    if (response.request().method() !== method) {
      return false;
    }

    const pathname = new URL(response.url()).pathname;
    return typeof path === 'string' ? pathname === path : path.test(pathname);
  });
}

async function recordOkJson(
  response: PlaywrightResponse,
  evidence: SmokeEvidence,
  name: string,
  validate: (body: any) => boolean
) {
  const text = await response.text();
  const body = parseJson(text);

  evidence.steps.push({
    name,
    method: response.request().method(),
    path: new URL(response.url()).pathname,
    status: response.status(),
    bodyPreview: preview(text)
  });

  expect(response.ok(), `${name} response ${response.status()}: ${text}`).toBe(true);
  expect(validate(body), `${name} response DTO shape: ${text}`).toBe(true);
  return body;
}

async function recordFailureJson(
  response: PlaywrightResponse,
  evidence: SmokeEvidence,
  name: string,
  expectedStatus: number,
  validate: (body: any) => boolean
) {
  const text = await response.text();
  const body = parseJson(text);

  evidence.steps.push({
    name,
    method: response.request().method(),
    path: new URL(response.url()).pathname,
    status: response.status(),
    bodyPreview: preview(text)
  });

  expect(response.status(), `${name} response status: ${text}`).toBe(expectedStatus);
  expect(validate(body), `${name} response DTO shape: ${text}`).toBe(true);
  return body;
}

async function recordFetchJson(
  page: Page,
  evidence: SmokeEvidence,
  name: string,
  path: string,
  options: {
    validate: (body: any) => boolean;
    sensitive?: boolean;
  }
) {
  const result = await fetchFromPage(page, path);
  const body = parseJson(result.text);

  evidence.steps.push({
    name,
    method: 'GET',
    path,
    status: result.status,
    bodyPreview: options.sensitive ? '[redacted]' : preview(result.text)
  });

  expect(result.ok, `${name} response ${result.status}: ${options.sensitive ? '[redacted]' : result.text}`).toBe(true);
  expect(options.validate(body), `${name} response DTO shape`).toBe(true);
  return body;
}

async function fetchFromPage(page: Page, path: string): Promise<{ ok: boolean; status: number; text: string }> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include' });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text()
    };
  }, path);
}

async function fetchJsonFromPage(page: Page, path: string): Promise<{ status: number; body: any }> {
  const result = await fetchFromPage(page, path);
  return {
    status: result.status,
    body: parseJson(result.text)
  };
}

/** Acquires the anti-forgery token in the browser and never serializes it into evidence. */
async function requestWithCsrf(page: Page, method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; text: string }> {
  return page.evaluate(async ({ method, path, body }) => {
    const csrfResponse = await fetch('/api/security/csrf-token', { credentials: 'include' });
    const csrf = await csrfResponse.json() as { token?: string; headerName?: string };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrf.token && csrf.headerName) headers[csrf.headerName] = csrf.token;
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, text: await response.text() };
  }, { method, path, body });
}

function recordFailedApiResponse(response: PlaywrightResponse, evidence: SmokeEvidence) {
  const url = new URL(response.url());
  if (!url.pathname.startsWith('/api/') || response.status() < 400) {
    return;
  }

  evidence.failedApiResponses.push({
    method: response.request().method(),
    path: url.pathname,
    status: response.status()
  });
}

function expectUnexpectedApiFailures(evidence: SmokeEvidence) {
  const unexpected = evidence.failedApiResponses.filter((failure) => !isExpectedFailure(failure));
  expect(unexpected, 'unexpected failed API responses').toEqual([]);
}

function expectUnexpectedConsoleErrors(evidence: SmokeEvidence) {
  const unexpected = evidence.consoleErrors.filter((message) => !message.includes('404'));
  expect(unexpected, 'unexpected browser console errors').toEqual([]);
}

function isExpectedFailure(failure: SmokeFailedApiResponse): boolean {
  return (
    (failure.method === 'POST' && failure.path === '/api/auth/change-password' && failure.status === 403) ||
    (failure.method === 'POST' && failure.path === '/api/auth/change-password' && failure.status === 400) ||
    (failure.method === 'GET' && failure.path === '/api/auth/me' && failure.status === 401) ||
    (failure.method === 'GET' && failure.path === '/api/projects' && failure.status === 401) ||
    (failure.method === 'GET' && /^\/api\/tasks\/[0-9a-f-]+$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'POST' && /^\/api\/attachments\/[0-9a-f-]+\/download-grants$/i.test(failure.path) && failure.status === 404)
  );
}

async function verifyRealtimeRuntimeConfig(page: Page, evidence: SmokeEvidence): Promise<void> {
  const enabled = await page.evaluate(() => window.__AIP_FEATURE_FLAGS__?.['realtime.signalR'] === true);
  evidence.steps.push({ name: 'realtime-runtime-config-enabled', method: 'GET', path: '/api/ui/runtime-config.js', status: enabled ? 200 : 500 });
  expect(enabled, 'same-origin runtime configuration must enable the realtime rollout').toBe(true);
}

function expectCanonicalDenial(text: string, expectedCode: string): void {
  const body = parseJson(text) as Record<string, any>;
  expect(typeof body.requestId, 'safe denial requestId').toBe('string');
  expect(body.error?.code, 'safe denial error code').toBe(expectedCode);
  expect(text, 'safe denial must not expose protected metadata').not.toMatch(/browser-smoke-task|browser smoke label|storageKey|filePath|tokenHash|policy stamp|internal\//i);
}

function isPagedResponse(body: unknown): body is { items: Record<string, unknown>[] } {
  return typeof body === 'object' && body !== null && Array.isArray((body as Record<string, unknown>).items);
}

function isPr03cTaskDetail(body: unknown, taskId: string, projectId: string): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const detail = body as Record<string, any>;
  const task = detail.task;
  return hasStringValue(task, 'id', taskId) &&
    hasStringValue(task, 'projectId', projectId) &&
    hasStringValue(task, 'title', smokeTaskTitle) &&
    hasString(task, 'workspaceId') &&
    typeof task.version === 'number' &&
    typeof task.priority === 'string' &&
    typeof task.stageCategory === 'number' &&
    typeof task.reviewStatus === 'number' &&
    detail.relationships && typeof detail.relationships === 'object' &&
    detail.permissions && typeof detail.permissions === 'object' &&
    Array.isArray(detail.checklist) && Array.isArray(detail.labels) &&
    detail.watchState && typeof detail.watchState === 'object' &&
    isPagedResponse(detail.subtasks) && isPagedResponse(detail.comments) && isPagedResponse(detail.files) &&
    detail.files.items.length > 0 &&
    hasStringValue(detail.files.items[0], 'fileName', smokeTaskFileName) &&
    typeof detail.files.items[0].scanStatus === 'string' &&
    typeof detail.files.items[0].canOpen === 'boolean' &&
    typeof detail.files.items[0].canRequestDownloadGrant === 'boolean';
}

function hasString(body: unknown, key: string): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>)[key] === 'string';
}

function hasStringValue(body: unknown, key: string, expected: string): boolean {
  return hasString(body, key) && (body as Record<string, unknown>)[key] === expected;
}

function hasCapability(body: unknown, capability: string): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as Record<string, unknown>).capabilities) &&
    (body as Record<string, unknown>).capabilities.includes(capability)
  );
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function preview(text: string): string {
  return text.slice(0, 320);
}

interface SmokeEvidence {
  baseURL: string;
  email: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
  messageBody?: string;
  announcementId?: string;
  projectId?: string;
  taskId?: string;
  workspaceId?: string;
  steps: SmokeEvidenceStep[];
  pageErrors: string[];
  consoleErrors: string[];
  failedApiResponses: SmokeFailedApiResponse[];
}

interface SmokeEvidenceStep {
  name: string;
  method?: string;
  path?: string;
  status?: number;
  body?: unknown;
  bodyPreview?: string;
}

interface SmokeFailedApiResponse {
  method: string;
  path: string;
  status: number;
}
