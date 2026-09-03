import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

const smokeEmail = process.env.AIP_BROWSER_SMOKE_EMAIL ?? '';
const smokePassword = process.env.AIP_BROWSER_SMOKE_PASSWORD ?? '';
const smokeProjectTitle = 'Browser Smoke Project';
const smokeTaskTitle = 'Browser smoke task';
const smokeTaskFileName = 'browser-smoke-task.txt';

test.describe('Task execution real-backend golden path', () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    if (process.env.AIP_REAL_BACKEND_SMOKE !== '1') {
      throw new Error('This golden path requires AIP_REAL_BACKEND_SMOKE=1. Use `npm run test:ui:real-backend`.');
    }

    const baseURL = process.env.PLAYWRIGHT_BASE_URL;
    if (!baseURL || /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost):4173(?:\/|$)/i.test(baseURL)) {
      throw new Error('The task-execution golden path requires the Compose real backend, not the static Angular server.');
    }

    if (!smokeEmail || !smokeEmail.toLowerCase().endsWith('@example.test') || !smokePassword) {
      throw new Error('Synthetic real-backend smoke credentials are required.');
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'The real-backend golden path runs once because it mutates a shared seeded Task.',
    );
  });

  test('starts a server-authorized Project Files run and preserves its durable result', async ({ page }, testInfo) => {
    const evidence: Record<string, unknown> = {
      projectTitle: smokeProjectTitle,
      taskTitle: smokeTaskTitle,
      requestBody: null,
      requestHeaders: null,
      acceptedRun: null,
      replayedRun: null,
      durableResult: null,
      unauthorizedStatuses: null,
    };
    let taskId = '';
    let originalTaskScope: Record<string, any> | null = null;
    let scopeRestored = false;

    try {
      await login(page);

      const projects = await expectJsonOk(page, '/api/projects?page=1&pageSize=100');
      const project = projects.items?.find((item: Record<string, unknown>) => item.title === smokeProjectTitle);
      expect(project, 'seeded Project').toBeTruthy();
      const projectId = String(project.id);

      const tasks = await expectJsonOk(page, `/api/projects/${projectId}/tasks?page=1&pageSize=100`);
      const task = tasks.items?.find((item: Record<string, unknown>) => item.title === smokeTaskTitle);
      expect(task, 'seeded Task').toBeTruthy();
      taskId = String(task.id);
      expect(task.hasArtifact, 'the seeded Task has a real attached Project file').toBe(true);

      originalTaskScope = await expectJsonOk(page, `/api/tasks/${taskId}/execution-scope`);
      expect(originalTaskScope.canManage, 'the seeded owner may configure and run the Task').toBe(true);

      await page.goto(`/app/projects/${projectId}/tasks/${taskId}`);
      await expect(page.getByTestId('task-detail-page')).toBeVisible();
      await expect(page.getByRole('heading', { name: smokeTaskTitle })).toBeVisible();

      const scopePanel = page.getByTestId('task-execution-scope');
      await expect(scopePanel).toBeVisible();
      const taskScopeGroup = scopePanel.getByRole('group', { name: 'Task source setting' });
      await expect(taskScopeGroup).toBeVisible();
      await taskScopeGroup.getByRole('radio', { name: /Use a complete Task override/ }).check();

      const webCheckbox = taskScopeGroup.getByRole('checkbox', { name: /Allow Web as a future source/ });
      const filesCheckbox = taskScopeGroup.getByRole('checkbox', { name: /Allow authorized Project files as a future source/ });
      await expect(webCheckbox).toBeVisible();
      await expect(filesCheckbox).toBeVisible();
      if (await webCheckbox.isChecked()) {await webCheckbox.uncheck();}
      if (!await filesCheckbox.isChecked()) {await filesCheckbox.check();}

      const saveResponsePromise = waitForApiResponse(page, 'PUT', `/api/tasks/${taskId}/execution-scope-override`);
      await taskScopeGroup.getByRole('button', { name: 'Save Task source setting' }).click();
      const saveResponse = await saveResponsePromise;
      const saveText = await saveResponse.text();
      expect(saveResponse.status(), `Task scope save response: ${saveText}`).toBe(200);
      expect(saveResponse.request().postDataJSON()).toMatchObject({
        webEnabled: false,
        projectFilesEnabled: true,
      });
      expect(saveResponse.request().headers()['x-csrf-token'], 'Task scope save uses the Angular CSRF interceptor').toBeTruthy();

      await expect(scopePanel.getByTestId('task-context-summary-web')).toContainText('Web: Exclude');
      await expect(scopePanel.getByTestId('task-context-summary-files')).toContainText('Project files: Allow');

      const startResponsePromise = waitForApiResponse(page, 'POST', `/api/tasks/${taskId}/execution-runs`);
      const startButton = scopePanel.getByTestId('task-execution-start');
      await expect(startButton).toBeVisible();
      await expect(startButton).toBeEnabled();
      await startButton.click();
      const startResponse = await startResponsePromise;
      const startText = await startResponse.text();
      expect(startResponse.status(), `Task execution response: ${startText}`).toBe(201);

      const startRequest = startResponse.request();
      const requestBody = startRequest.postDataJSON() as Record<string, unknown>;
      const requestHeaders = startRequest.headers();
      const idempotencyKey = requestHeaders['idempotency-key'] ?? '';
      expect(requestBody).toEqual({});
      expect(idempotencyKey).toMatch(/^[\x20-\x7e]{8,128}$/u);
      expect(requestHeaders['x-csrf-token'], 'Task execution uses the Angular CSRF interceptor').toBeTruthy();
      for (const forbidden of ['candidateIds', 'fileIds', 'fsPath', 'materializedSources', 'evidence', 'sources']) {
        expect(JSON.stringify(requestBody)).not.toContain(forbidden);
      }

      const acceptedRun = parseJson(startText) as Record<string, any>;
      expect(acceptedRun.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(acceptedRun.status).toBe('Succeeded');
      expect(acceptedRun.snapshotScopeOrigin).toBe('TaskOverride');
      expect(acceptedRun.snapshotWebEnabled).toBe(false);
      expect(acceptedRun.snapshotProjectFilesEnabled).toBe(true);
      evidence.requestBody = requestBody;
      evidence.requestHeaders = {
        idempotencyKeyPresent: idempotencyKey.length > 0,
        csrfHeaderPresent: Boolean(requestHeaders['x-csrf-token']),
      };
      evidence.acceptedRun = acceptedRun;

      await expect(scopePanel.getByTestId('task-execution-result-status')).toHaveText('Succeeded', { timeout: 30_000 });
      const report = scopePanel.getByTestId('task-execution-report');
      await expect(report).toBeVisible();
      await expect(report).toContainText('Project Files Analysis Report');
      const reportBody = scopePanel.getByTestId('task-execution-report-body');
      await expect(reportBody).toContainText(/Authorized sources consumed: [1-9]/);
      await expect(reportBody).not.toContainText(smokeTaskFileName);
      await expect(reportBody).not.toContainText('/srv/');
      await expect(reportBody).not.toContainText('Synthetic PR03C browser smoke file.');

      const durableResultResponse = await fetchFromPage(
        page,
        `/api/tasks/${taskId}/execution-runs/${acceptedRun.id}/result`,
      );
      expect(durableResultResponse.status, durableResultResponse.text).toBe(200);
      const durableResult = parseJson(durableResultResponse.text) as Record<string, any>;
      expect(durableResult.runId).toBe(acceptedRun.id);
      expect(durableResult.status).toBe('Succeeded');
      expect(durableResult.report?.title).toBe('Project Files Analysis Report');
      expect(durableResult.report?.bodyMarkdown).toMatch(/Authorized sources consumed: [1-9]/);
      expect(durableResult.report?.bodyMarkdown).not.toContain(smokeTaskFileName);
      evidence.durableResult = durableResult;

      const replay = await requestWithCsrf(
        page,
        'POST',
        `/api/tasks/${taskId}/execution-runs`,
        {},
        { 'Idempotency-Key': idempotencyKey },
      );
      expect(replay.csrfHeaderPresent).toBe(true);
      expect(replay.status, replay.text).toBe(201);
      const replayedRun = parseJson(replay.text) as Record<string, any>;
      expect(replayedRun.id).toBe(acceptedRun.id);
      expect(replayedRun.status).toBe('Succeeded');
      evidence.replayedRun = replayedRun;

      await page.reload();
      await expect(page.getByTestId('task-detail-page')).toBeVisible();
      await expect(page.getByTestId('task-execution-result-status')).toHaveText('Succeeded', { timeout: 30_000 });
      await expect(page.getByTestId('task-execution-report-body')).toContainText(/Authorized sources consumed: [1-9]/);

      await restoreTaskScope(page, taskId, originalTaskScope);
      scopeRestored = true;

      const logout = await requestWithCsrf(page, 'POST', '/api/auth/logout');
      expect(logout.status, logout.text).toBe(200);

      const deniedRead = await fetchFromPage(page, `/api/tasks/${taskId}/execution-runs/${acceptedRun.id}/result`);
      const deniedStart = await requestWithCsrf(
        page,
        'POST',
        `/api/tasks/${taskId}/execution-runs`,
        {},
        { 'Idempotency-Key': `task-execution-denied-${randomUUID()}` },
      );
      expect(deniedRead.status).toBe(401);
      expect(deniedStart.status).toBe(401);

      const deniedText = `${deniedRead.text}\n${deniedStart.text}`;
      expect(deniedText).not.toContain(smokeProjectTitle);
      expect(deniedText).not.toContain(smokeTaskTitle);
      expect(deniedText).not.toContain(smokeTaskFileName);
      expect(deniedText).not.toContain('Project Files Analysis Report');
      expect(deniedText).not.toContain(String(durableResult.report?.contentSha256 ?? 'never-match'));
      evidence.unauthorizedStatuses = { read: deniedRead.status, start: deniedStart.status };
    } finally {
      if (!scopeRestored && taskId && originalTaskScope) {
        try {
          await restoreTaskScope(page, taskId, originalTaskScope);
        } catch {
          // The primary assertion remains authoritative; Compose discards this isolated database after the job.
        }
      }
      await testInfo.attach('task-execution-golden-path-evidence.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
    }
  });
});

async function login(page: Page): Promise<void> {
  await page.goto('/app/login');
  await expect(page.getByTestId('login-page')).toBeVisible();
  const csrf = await fetchFromPage(page, '/api/security/csrf-token');
  expect(csrf.status, csrf.text).toBe(200);

  await page.getByTestId('login-email').fill(smokeEmail);
  await page.getByTestId('login-password').fill(smokePassword);
  const loginResponsePromise = waitForApiResponse(page, 'POST', '/api/auth/login');
  await page.getByTestId('login-submit').click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status(), await loginResponse.text()).toBe(200);
  await expect(page).toHaveURL(/\/app\/workspaces$/);
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function restoreTaskScope(
  page: Page,
  taskId: string,
  original: Record<string, any>,
): Promise<void> {
  const current = await expectJsonOk(page, `/api/tasks/${taskId}/execution-scope`);
  if (original.origin === 'ProjectDefault') {
    if (current.taskOverrideVersion !== null) {
      const response = await requestWithCsrf(
        page,
        'DELETE',
        `/api/tasks/${taskId}/execution-scope-override`,
        { expectedVersion: current.taskOverrideVersion },
      );
      expect(response.status, response.text).toBe(200);
    }
    return;
  }

  const originalPolicy = original.taskOverridePolicy as Record<string, boolean>;
  const response = await requestWithCsrf(
    page,
    'PUT',
    `/api/tasks/${taskId}/execution-scope-override`,
    {
      webEnabled: originalPolicy.webEnabled,
      projectFilesEnabled: originalPolicy.projectFilesEnabled,
      expectedVersion: current.taskOverrideVersion ?? 0,
    },
  );
  expect(response.status, response.text).toBe(200);
}

async function expectJsonOk(page: Page, path: string): Promise<any> {
  const response = await fetchFromPage(page, path);
  expect(response.status, `${path}: ${response.text}`).toBe(200);
  return parseJson(response.text);
}

async function fetchFromPage(page: Page, path: string): Promise<{ status: number; text: string }> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include' });
    return { status: response.status, text: await response.text() };
  }, path);
}

async function requestWithCsrf(
  page: Page,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  additionalHeaders: Readonly<Record<string, string>> = {},
): Promise<{ status: number; text: string; csrfHeaderPresent: boolean }> {
  return page.evaluate(async ({ method, path, body, additionalHeaders }) => {
    const csrfResponse = await fetch('/api/security/csrf-token', { credentials: 'include' });
    const csrf = await csrfResponse.json() as { token?: string; headerName?: string };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...additionalHeaders,
    };
    if (csrf.token && csrf.headerName) {headers[csrf.headerName] = csrf.token;}
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      text: await response.text(),
      csrfHeaderPresent: Boolean(csrf.token && csrf.headerName && headers[csrf.headerName]),
    };
  }, { method, path, body, additionalHeaders });
}

function waitForApiResponse(page: Page, method: string, path: string) {
  return page.waitForResponse((response) =>
    response.request().method() === method && new URL(response.url()).pathname === path,
  );
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}