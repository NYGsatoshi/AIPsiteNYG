import { expect, type Page, type Response as PlaywrightResponse, test } from '@playwright/test';

const smokeEmail = process.env.AIP_BROWSER_SMOKE_EMAIL ?? '';
const smokePassword = process.env.AIP_BROWSER_SMOKE_PASSWORD ?? '';

const smokeWorkspaceName = 'Browser Smoke Workspace';
const smokeAnnouncementTitle = 'Browser smoke announcement';
const smokeProjectTitle = 'Browser Smoke Project';
const smokeTaskTitle = 'Browser smoke task';
const smokeRecipientName = 'Browser Smoke Recipient';

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
      await loginAndVerifySession(page, evidence);
      await assertCsrfRejectsMissingToken(page, evidence);
      await openWorkspaces(page, evidence);
      await createDirectMessageAndVerifyPersistence(page, evidence);
      await openAnnouncementDetail(page, evidence);
      await openProjectTaskDetail(page, evidence);
      await submitInvalidPasswordChange(page, evidence);
      await logoutAndVerifyAccessRevoked(page, evidence);

      expect(evidence.pageErrors, 'browser page errors').toEqual([]);
      expect(
        evidence.consoleErrors.filter((message) => !message.includes('404')),
        'unexpected browser console errors'
      ).toEqual([]);
      expectUnexpectedApiFailures(evidence);
    } finally {
      await testInfo.attach('real-backend-smoke-evidence.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json'
      });
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

  await recordFetchJson(page, evidence, 'auth-me', '/api/auth/me', {
    validate: (body) =>
      hasStringValue(body, 'userId', evidence.userId ?? '') &&
      hasStringValue(body, 'email', smokeEmail) &&
      Array.isArray((body as Record<string, unknown>).workspaces)
  });
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

  const taskRow = page.locator('[role="row"]').filter({ hasText: smokeTaskTitle }).first();
  await expect(taskRow).toBeVisible();
  await taskRow.getByTestId('task-action-openDetail').click();

  await expect(page.getByTestId('task-detail-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: smokeTaskTitle })).toBeVisible();
  await recordFetchJson(page, evidence, 'task-detail', `/api/tasks/${evidence.taskId}`, {
    validate: (body) =>
      hasStringValue(body, 'id', evidence.taskId ?? '') &&
      hasStringValue(body, 'title', smokeTaskTitle) &&
      hasStringValue(body, 'projectId', evidence.projectId ?? '')
  });
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

function isExpectedFailure(failure: SmokeFailedApiResponse): boolean {
  return (
    (failure.method === 'POST' && failure.path === '/api/auth/change-password' && failure.status === 403) ||
    (failure.method === 'POST' && failure.path === '/api/auth/change-password' && failure.status === 400) ||
    (failure.method === 'GET' && failure.path === '/api/auth/me' && failure.status === 401) ||
    (failure.method === 'GET' && failure.path === '/api/projects' && failure.status === 401)
  );
}

function isPagedResponse(body: unknown): body is { items: Record<string, unknown>[] } {
  return typeof body === 'object' && body !== null && Array.isArray((body as Record<string, unknown>).items);
}

function hasString(body: unknown, key: string): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>)[key] === 'string';
}

function hasStringValue(body: unknown, key: string, expected: string): boolean {
  return hasString(body, key) && (body as Record<string, unknown>)[key] === expected;
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
