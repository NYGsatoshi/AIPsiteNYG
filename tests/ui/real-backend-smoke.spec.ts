import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, type Response as PlaywrightResponse, test } from '@playwright/test';

const smokeEmail = process.env.AIP_BROWSER_SMOKE_EMAIL ?? '';
const smokePassword = process.env.AIP_BROWSER_SMOKE_PASSWORD ?? '';

const smokeWorkspaceName = 'Browser Smoke Workspace';
const smokeAnnouncementTitle = 'Browser smoke announcement';
const smokeProjectTitle = 'Browser Smoke Project';
const smokeTaskTitle = 'Browser smoke task';
const smokeRecipientName = 'Browser Smoke Recipient';
const smokeTaskLabelName = 'Browser smoke label';
const smokeTaskFileName = 'browser-smoke-task.txt';
const pr05ManagerEmail = 'browser-smoke-pr05-manager@example.test';
const pr06ViewerEmail = 'browser-smoke-recipient@example.test';
const pr05ProjectTitle = 'PR05 Browser Acceptance Project';
const pr05ProjectSlug = 'browser-smoke-pr05-kanban';
const pr05ResponseGateCookieName = 'AipBrowserSmokeResponseGate';
const pr05ResponseGateHeaderName = 'x-aip-browser-smoke-response-gate';
const pr05ResponseGatePath = '/internal/browser-smoke/response-gates';
const pr05TaskTitles = {
  move: 'PR05 real move card',
  reorder: 'PR05 stable reorder card',
  neighbor: 'PR05 stable neighbor card',
  cancellation: 'PR05 cancellation card',
  conflict: 'PR05 stale conflict card'
} as const;
const pr06ProjectTitle = 'PR06 Browser Acceptance Project';
const pr06ProjectSlug = 'browser-smoke-pr06-gantt';
const pr06TaskTitles = {
  parent: 'PR06 derived parent',
  schedule: 'PR06 schedule task',
  predecessor: 'PR06 predecessor task',
  unscheduled: 'PR06 unscheduled task',
  conflict: 'PR06 conflict task',
  successor: 'PR06 dependency successor'
} as const;
const pr06MilestoneTitle = 'PR06 release milestone';
const pr07NotificationFixturePath = '/internal/browser-smoke/notifications';
const pr07ProjectTitle = 'PR07 Browser Smoke Notifications Project';
const pr07TaskTitle = 'PR07 authorized notification task';
const pr07NotificationTitle = 'PR07D authorized delivery smoke notification';

test.describe('MVP0 real backend browser smoke', () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    if (process.env.AIP_REAL_BACKEND_SMOKE !== '1') {
      throw new Error('This real-backend smoke requires AIP_REAL_BACKEND_SMOKE=1. Use `npm run test:ui:real-backend`; do not run it against the static Angular mock server.');
    }

    const baseURL = process.env.PLAYWRIGHT_BASE_URL;
    if (!baseURL || /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost):4173(?:\/|$)/i.test(baseURL)) {
      throw new Error('The real-backend smoke requires a non-static PLAYWRIGHT_BASE_URL. Use `npm run test:ui:real-backend`, which runs Playwright inside Compose at http://aip-backend:8080.');
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
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, window.location.href).pathname.startsWith('/hubs/app')) {
          return Promise.reject(new TypeError('Synthetic Hub unavailability'));
        }

        return nativeFetch(input, init);
      };
    });
    const evidence: SmokeEvidence = { baseURL: String(testInfo.project.use.baseURL ?? ''), email: smokeEmail, steps: [], pageErrors: [], consoleErrors: [], failedApiResponses: [] };

    await loginAndVerifySession(page, evidence);
    await expect(page.getByTestId('realtime-connection-state')).toContainText('Realtime updates are delayed');
    await recordFetchJson(page, evidence, 'degraded-http-auth-status', '/api/auth/status', {
      validate: (body) => body && typeof body === 'object' && (body as Record<string, unknown>).isAuthenticated === true
    });

    const myTasksResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
    await page.getByTestId('nav-my-tasks').first().click();
    await recordOkJson(await myTasksResponse, evidence, 'degraded-my-tasks-http-list', (body) => isPagedResponse(body));
    const refreshResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
    await page.getByTestId('my-tasks-refresh').click();
    await recordOkJson(await refreshResponse, evidence, 'degraded-my-tasks-manual-refresh', (body) => isPagedResponse(body));
  });

  test('TASK-V1-PR04 exercises canonical My Tasks scopes, relationships, filters, paging, and UI against PostgreSQL', async ({ page }, testInfo) => {
    const evidence: SmokeEvidence = {
      baseURL: String(testInfo.project.use.baseURL ?? ''), email: smokeEmail, steps: [], pageErrors: [], consoleErrors: [], failedApiResponses: []
    };
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
    page.on('response', (response) => recordFailedApiResponse(response, evidence));

    try {
      await loginAndVerifySession(page, evidence);
      const workspaces = await recordFetchJson(page, evidence, 'pr04-workspaces', '/api/workspaces', {
        validate: (body) => Array.isArray(body) &&
          body.some((item: unknown) => hasStringValue(item, 'name', smokeWorkspaceName)) &&
          body.some((item: unknown) => hasStringValue(item, 'name', 'Browser Smoke Workspace Two'))
      }) as Record<string, unknown>[];
      const primaryWorkspace = workspaces.find((item) => item.name === smokeWorkspaceName)!;
      const secondWorkspace = workspaces.find((item) => item.name === 'Browser Smoke Workspace Two')!;
      const primaryWorkspaceId = String(primaryWorkspace.id);
      const secondWorkspaceId = String(secondWorkspace.id);
      evidence.workspaceId = primaryWorkspaceId;

      const omitted = await fetchJsonFromPage(page, '/api/me/tasks?view=assigned');
      evidence.steps.push({ name: 'pr04-multiple-workspace-requires-explicit-id', method: 'GET', path: '/api/me/tasks', status: omitted.status });
      expect(omitted.status).toBe(400);
      expect(omitted.body?.error?.code).toBe('MY_TASKS_INVALID_WORKSPACE_SCOPE');

      const currentPath = `/api/me/tasks?view=assigned&workspaceId=${primaryWorkspaceId}&page=1&pageSize=100`;
      const current = await recordFetchJson(page, evidence, 'pr04-current-workspace', currentPath, {
        validate: (body) => isPagedResponse(body) &&
          body.workspaceId === primaryWorkspaceId &&
          body.items.some((item: unknown) => hasStringValue(item, 'title', smokeTaskTitle)) &&
          !body.items.some((item: unknown) => hasStringValue(item, 'title', 'PR04 second workspace assigned'))
      }) as Record<string, any>;
      expect(new Set(current.items.map((item: Record<string, unknown>) => item.taskId)).size).toBe(current.items.length);

      const allPath = '/api/me/tasks?view=assigned&scope=allWorkspaces&page=1&pageSize=100';
      const all = await recordFetchJson(page, evidence, 'pr04-all-workspaces', allPath, {
        validate: (body) => isPagedResponse(body) &&
          body.availableWorkspaceCount === 2 &&
          body.items.some((item: unknown) => hasStringValue(item, 'title', smokeTaskTitle)) &&
          body.items.some((item: unknown) => hasStringValue(item, 'title', 'PR04 second workspace assigned'))
      }) as Record<string, any>;
      expect(all.items.every((item: Record<string, unknown>) => typeof item.workspaceTitle === 'string' && item.workspaceTitle.length > 0)).toBe(true);

      const expectedByView: Record<string, string> = {
        assigned: smokeTaskTitle,
        participating: 'PR04 participating task',
        reviews: 'PR04 review task',
        created: 'PR04 created task',
        watching: 'PR04 watching task',
        teamQueue: 'PR04 team queue task',
        completed: 'PR04 completed task'
      };
      for (const [view, title] of Object.entries(expectedByView)) {
        const body = await recordFetchJson(
          page,
          evidence,
          `pr04-view-${view}`,
          `/api/me/tasks?view=${view}&workspaceId=${primaryWorkspaceId}&page=1&pageSize=100`,
          {
            validate: (value) => isPagedResponse(value) &&
              value.items.some((item: unknown) => hasStringValue(item, 'title', title))
          }
        ) as Record<string, any>;
        expect(new Set(body.items.map((item: Record<string, unknown>) => item.taskId)).size, `${view} contains no duplicate Task`).toBe(body.items.length);
      }

      const filteredPath = `/api/me/tasks?view=assigned&workspaceId=${primaryWorkspaceId}&projectId=${current.items[0].projectId}&stageCategory=todo&priority=critical&blocked=true&search=${encodeURIComponent('PR04 critical blocked match')}&timeGroup=today&page=1&pageSize=10`;
      const filtered = await recordFetchJson(page, evidence, 'pr04-filter-combination', filteredPath, {
        validate: (body) => isPagedResponse(body) &&
          body.totalCount === 1 &&
          body.items.length === 1 &&
          hasStringValue(body.items[0], 'title', 'PR04 critical blocked match')
      }) as Record<string, any>;
      expect(filtered.items[0].timeGroup).toBe('Today');

      const firstPage = await recordFetchJson(
        page,
        evidence,
        'pr04-page-1',
        `/api/me/tasks?view=assigned&workspaceId=${primaryWorkspaceId}&page=1&pageSize=10`,
        { validate: (body) => isPagedResponse(body) && body.page === 1 && body.pageSize === 10 && body.totalCount > 10 }
      ) as Record<string, any>;
      const secondPage = await recordFetchJson(
        page,
        evidence,
        'pr04-page-2',
        `/api/me/tasks?view=assigned&workspaceId=${primaryWorkspaceId}&page=2&pageSize=10`,
        { validate: (body) => isPagedResponse(body) && body.page === 2 && body.pageSize === 10 }
      ) as Record<string, any>;
      const firstPageIds = new Set(firstPage.items.map((item: Record<string, unknown>) => item.taskId));
      expect(secondPage.items.some((item: Record<string, unknown>) => firstPageIds.has(item.taskId))).toBe(false);

      const counts = await recordFetchJson(
        page,
        evidence,
        'pr04-row-count-consistency',
        `/api/me/tasks/counts?view=assigned&workspaceId=${primaryWorkspaceId}`,
        {
          validate: (body) => body && typeof body === 'object' &&
            Array.isArray((body as Record<string, unknown>).views) &&
            Array.isArray((body as Record<string, unknown>).timeGroups)
        }
      ) as Record<string, any>;
      expect(counts.views.find((item: Record<string, unknown>) => item.view === 'Assigned')?.count).toBe(current.totalCount);

      const initialUiRequest = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.goto('/app/tasks');
      const initialUiResponse = await initialUiRequest;
      expect(new URL(initialUiResponse.url()).searchParams.get('workspaceId')).toBe(primaryWorkspaceId);
      await expect(page.getByTestId('my-tasks-workspace-select')).toHaveValue(primaryWorkspaceId);
      await expect(page.getByRole('tab')).toHaveCount(7);
      await expect(page.getByRole('tab', { name: /^Assigned to Me/ })).toHaveAttribute('aria-selected', 'true');

      const participatingResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByRole('tab', { name: /^Assigned to Me/ }).press('ArrowRight');
      await recordOkJson(await participatingResponse, evidence, 'pr04-keyboard-tab-participating', (body) =>
        isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', 'PR04 participating task')));
      await expect(page.getByRole('tab', { name: /^Participating/ })).toHaveAttribute('aria-selected', 'true');

      const assignedResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByRole('tab', { name: /^Assigned to Me/ }).click();
      await recordOkJson(await assignedResponse, evidence, 'pr04-ui-assigned', (body) => isPagedResponse(body));

      const secondWorkspaceResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-workspace-select').selectOption(secondWorkspaceId);
      const secondWorkspaceList = await recordOkJson(await secondWorkspaceResponse, evidence, 'pr04-ui-workspace-switch', (body) =>
        isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', 'PR04 second workspace assigned')));
      expect(secondWorkspaceList.page).toBe(1);
      await expect(page.getByText('PR04 second workspace assigned', { exact: true })).toBeVisible();

      const primaryWorkspaceResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-workspace-select').selectOption(primaryWorkspaceId);
      await recordOkJson(await primaryWorkspaceResponse, evidence, 'pr04-ui-workspace-switch-back', (body) =>
        isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', smokeTaskTitle)));

      const searchResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-search').fill('PR04 critical blocked match');
      await recordOkJson(await searchResponse, evidence, 'pr04-ui-search-debounce', (body) =>
        isPagedResponse(body) && body.totalCount === 1);
      await expect(page.getByText('PR04 critical blocked match', { exact: true })).toBeVisible();

      const priorityResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-priority-filter').selectOption('critical');
      await recordOkJson(await priorityResponse, evidence, 'pr04-ui-priority-filter', (body) =>
        isPagedResponse(body) && body.totalCount === 1);
      const blockedResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-blocked-filter').selectOption('true');
      await recordOkJson(await blockedResponse, evidence, 'pr04-ui-blocked-filter', (body) =>
        isPagedResponse(body) && body.totalCount === 1);
      const stageResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-stage-filter').selectOption('todo');
      await recordOkJson(await stageResponse, evidence, 'pr04-ui-stage-filter', (body) =>
        isPagedResponse(body) && body.totalCount === 1);
      const urgencyResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-urgency-filter').selectOption('today');
      await recordOkJson(await urgencyResponse, evidence, 'pr04-ui-urgency-filter', (body) =>
        isPagedResponse(body) && body.totalCount === 1);
      const projectResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-project-filter').fill(String(current.items[0].projectId));
      await page.getByTestId('my-tasks-project-filter').press('Tab');
      await recordOkJson(await projectResponse, evidence, 'pr04-ui-project-filter', (body) =>
        isPagedResponse(body) && body.totalCount === 1);

      await page.reload();
      await expect(page.getByTestId('my-tasks-page-size')).toBeVisible();
      const pageSizeResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-page-size').selectOption('10');
      await recordOkJson(await pageSizeResponse, evidence, 'pr04-ui-page-size', (body) =>
        isPagedResponse(body) && body.page === 1 && body.pageSize === 10 && body.totalCount > 10);
      const nextResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-next-page').click();
      await recordOkJson(await nextResponse, evidence, 'pr04-ui-next-page', (body) => isPagedResponse(body) && body.page === 2);
      const previousResponse = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-previous-page').click();
      await recordOkJson(await previousResponse, evidence, 'pr04-ui-previous-page', (body) => isPagedResponse(body) && body.page === 1);

      const secondBeforeRevocation = waitForApiResponse(page, 'GET', '/api/me/tasks');
      await page.getByTestId('my-tasks-workspace-select').selectOption(secondWorkspaceId);
      await recordOkJson(await secondBeforeRevocation, evidence, 'pr04-revocation-visible-before', (body) =>
        isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', 'PR04 second workspace assigned')));
      await expect(page.getByTestId('realtime-connection-state')).toContainText('Realtime updates connected.');
      const authorizationRefresh = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' &&
          url.pathname === '/api/me/tasks' &&
          url.searchParams.get('workspaceId') === primaryWorkspaceId;
      });
      const revokeSecond = await requestWithCsrf(page, 'DELETE', `/api/workspaces/${secondWorkspaceId}/members/${evidence.userId}`);
      evidence.steps.push({
        name: 'pr04-second-workspace-membership-revoked',
        method: 'DELETE',
        path: `/api/workspaces/${secondWorkspaceId}/members/${evidence.userId}`,
        status: revokeSecond.status
      });
      expect(revokeSecond.status).toBe(200);
      await recordOkJson(await authorizationRefresh, evidence, 'pr04-authorization-state-refresh', (body) =>
        isPagedResponse(body) &&
        !body.items.some((item: unknown) => hasStringValue(item, 'title', 'PR04 second workspace assigned')));
      await expect(page.getByText('PR04 second workspace assigned', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('my-tasks-workspace-select').locator(`option[value="${secondWorkspaceId}"]`)).toHaveCount(0);

      const afterRevocation = await recordFetchJson(
        page,
        evidence,
        'pr04-revocation-all-workspaces-row-clear',
        '/api/me/tasks?view=assigned&scope=allWorkspaces&page=1&pageSize=100',
        {
          validate: (body) => isPagedResponse(body) &&
            body.availableWorkspaceCount === 1 &&
            !body.items.some((item: unknown) => hasStringValue(item, 'title', 'PR04 second workspace assigned'))
        }
      ) as Record<string, any>;
      const countsAfterRevocation = await recordFetchJson(
        page,
        evidence,
        'pr04-revocation-count-clear',
        '/api/me/tasks/counts?view=assigned&scope=allWorkspaces',
        {
          validate: (body) => body && typeof body === 'object' &&
            body.availableWorkspaceCount === 1 &&
            Array.isArray(body.views)
        }
      ) as Record<string, any>;
      expect(countsAfterRevocation.views.find((item: Record<string, unknown>) => item.view === 'Assigned')?.count)
        .toBe(afterRevocation.totalCount);

      expect(evidence.pageErrors, 'browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(evidence);
      expectUnexpectedApiFailures(evidence);
    } finally {
      await testInfo.attach('task-v1-pr04-real-backend-evidence.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    }
  });

  test('TASK-V1-PR05 exercises the canonical Project Kanban from the real browser through PostgreSQL', async ({ page, browser }, testInfo) => {
    const evidence: Pr05KanbanEvidence = {
      baseURL: String(testInfo.project.use.baseURL ?? ''),
      email: pr05ManagerEmail,
      steps: [],
      pageErrors: [],
      consoleErrors: [],
      failedApiResponses: [],
      seed: {
        projectSlug: pr05ProjectSlug,
        projectTitle: pr05ProjectTitle,
        taskTitles: Object.values(pr05TaskTitles)
      },
      apiInterception: 'none',
      featureFallback: 'Covered by the retained mocked Angular browser scenario; the real backend authorization path is not feature-flagged.',
      commands: []
    };
    let ownerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    let kanbanPostCount = 0;

    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
    page.on('response', (response) => recordFailedApiResponse(response, evidence));
    page.on('request', (request) => {
      if (request.method() === 'POST' && /^\/api\/tasks\/[0-9a-f-]+\/kanban-move$/i.test(new URL(request.url()).pathname)) {
        kanbanPostCount += 1;
      }
    });

    try {
      await loginAndVerifySession(page, evidence, { email: pr05ManagerEmail, password: smokePassword });
      await expect(page.getByTestId('realtime-connection-state')).toContainText('Realtime updates connected.', { timeout: 30_000 });

      const featureEnabled = await page.evaluate(() =>
        (window as Window & { __AIP_FEATURE_FLAGS__?: Record<string, boolean> })
          .__AIP_FEATURE_FLAGS__?.['tasks.kanbanV1'] === true);
      evidence.featureFlagEnabled = featureEnabled;
      expect(featureEnabled, 'the hosted runtime config enables the PR05 Kanban presentation').toBe(true);

      const tenant = await recordFetchJson(page, evidence, 'pr05-current-tenant', '/api/tenants/current', {
        validate: (body) => hasString(body, 'tenantId') && body.isAvailable === true && body.isPlatformScope === false
      }) as Record<string, any>;
      evidence.tenantId = String(tenant.tenantId);

      const workspaces = await recordFetchJson(page, evidence, 'pr05-workspaces', '/api/workspaces', {
        validate: (body) => Array.isArray(body) && body.some((item: unknown) => hasStringValue(item, 'name', smokeWorkspaceName))
      }) as Record<string, any>[];
      const workspace = workspaces.find((item) => item.name === smokeWorkspaceName)!;
      evidence.workspaceId = String(workspace.id);
      expect(evidence.workspaceId, 'synthetic Workspace id').toMatch(/^[0-9a-f-]{36}$/i);

      const projects = await recordFetchJson(page, evidence, 'pr05-projects', '/api/projects?page=1&pageSize=100', {
        validate: (body) => isPagedResponse(body) && body.items.some((item: unknown) => hasStringValue(item, 'title', pr05ProjectTitle))
      }) as Record<string, any>;
      const project = projects.items.find((item: Record<string, unknown>) => item.title === pr05ProjectTitle)!;
      evidence.projectId = String(project.id);
      expect(project.workspaceId, 'Project belongs to the expected synthetic Workspace').toBe(evidence.workspaceId);
      expect(evidence.projectId, 'synthetic Project id').toMatch(/^[0-9a-f-]{36}$/i);

      const projectMembers = await recordFetchJson(
        page,
        evidence,
        'pr05-project-members',
        `/api/projects/${evidence.projectId}/members`,
        {
          validate: (body) => Array.isArray(body) &&
            body.some((member: unknown) => hasStringValue(member, 'email', pr05ManagerEmail)) &&
            body.some((member: unknown) => hasStringValue(member, 'displayName', smokeRecipientName))
        }
      ) as Record<string, any>[];
      const managerMember = projectMembers.find((member) => member.email === pr05ManagerEmail)!;
      expect(String(managerMember.userId), 'logged-in Manager has the seeded Project membership').toBe(evidence.userId);

      const initialSnapshotResponse = waitForApiResponse(page, 'GET', `/api/projects/${evidence.projectId}/kanban`);
      await page.goto(`/app/projects/${evidence.projectId}`);
      const initialResponse = await initialSnapshotResponse;
      let snapshot = await recordOkJson(
        initialResponse,
        evidence,
        'pr05-initial-kanban-snapshot',
        isPr05KanbanSnapshot
      ) as Pr05KanbanSnapshotDto;

      const todo = pr05Stage(snapshot, 'Todo');
      const done = pr05Stage(snapshot, 'Done');
      const cancelled = pr05Stage(snapshot, 'Cancelled');
      const initialCards = Object.fromEntries(
        Object.entries(pr05TaskTitles).map(([key, title]) => [key, pr05Card(snapshot, title)])
      ) as Record<keyof typeof pr05TaskTitles, Pr05KanbanCardDto>;

      evidence.initialSnapshot = {
        responseUrl: initialResponse.url(),
        status: initialResponse.status(),
        tenantId: evidence.tenantId!,
        workspaceId: evidence.workspaceId!,
        projectId: String(snapshot.board.projectId),
        boardVersion: snapshot.board.version,
        taskIds: Object.fromEntries(Object.entries(initialCards).map(([key, card]) => [key, card.taskId])),
        taskVersions: Object.fromEntries(Object.entries(initialCards).map(([key, card]) => [key, card.version])),
        stages: {
          todo: todo.workflowStageId,
          done: done.workflowStageId,
          cancelled: cancelled.workflowStageId
        },
        totalAuthorizedCardCount: snapshot.board.totalAuthorizedCardCount,
        isTruncated: snapshot.board.isTruncated,
        canConfigure: snapshot.board.uiPermissions.canConfigure
      };
      expect(snapshot.board.projectId).toBe(evidence.projectId);
      expect(snapshot.board.totalAuthorizedCardCount).toBe(5);
      expect(snapshot.board.isTruncated).toBe(false);
      expect(snapshot.board.uiPermissions.canConfigure).toBe(true);
      expect(snapshot.cards.every((card) =>
        card.version > 0 &&
        card.uiPermissions.canOpen &&
        card.uiPermissions.canMove &&
        card.uiPermissions.allowedTargetWorkflowStageIds.includes(done.workflowStageId) &&
        card.uiPermissions.allowedTargetWorkflowStageIds.includes(cancelled.workflowStageId)
      ), 'card versions and backend-computed open/move/transition permissions').toBe(true);

      await expect(page).toHaveURL(new RegExp(`/app/projects/${evidence.projectId}$`));
      await expect(page.getByTestId('project-detail-page')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('aip-kanban-board')).toBeVisible();
      await expect(page.getByRole('heading', { name: pr05ProjectTitle })).toBeVisible();
      await expect(page.getByText('Warning: WIP limit 4 exceeded.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Configure board' })).toBeVisible();
      for (const card of Object.values(initialCards)) {
        const locator = pr05CardLocator(page, card.taskId);
        await expect(locator).toBeVisible();
        await expect(locator).toHaveAttribute('aria-label', new RegExp(`^${escapeRegExp(card.summary)}, current stage Todo$`));
        await expect(locator.getByRole('button', { name: 'Move', exact: true })).toBeVisible();
        await expect(locator.getByRole('button', { name: 'Open details', exact: true })).toBeVisible();
      }

      // Stable same-Stage reorder: the browser sends an explicit canonical
      // "before" neighbor intent and the persisted boardOrder survives reload.
      let reorderCard = pr05Card(snapshot, pr05TaskTitles.reorder);
      const moveCardBeforeReorder = pr05Card(snapshot, pr05TaskTitles.move);
      const reorderLocator = pr05CardLocator(page, reorderCard.taskId);
      await reorderLocator.getByRole('button', { name: 'Move', exact: true }).click();
      await reorderLocator.getByLabel('Target stage').selectOption(todo.workflowStageId);
      await reorderLocator.getByLabel('Position').selectOption(`before:${moveCardBeforeReorder.taskId}`);
      const reorderResponsePromise = waitForApiResponse(page, 'POST', `/api/tasks/${reorderCard.taskId}/kanban-move`);
      await reorderLocator.getByRole('button', { name: 'Apply move' }).click();
      const reorderCommand = await recordPr05KanbanCommand(await reorderResponsePromise, evidence, 'stable-reorder', 200);
      expect(reorderCommand.request).toMatchObject({
        targetWorkflowStageId: todo.workflowStageId,
        targetBeforeTaskId: moveCardBeforeReorder.taskId,
        targetAfterTaskId: null,
        expectedTaskVersion: reorderCard.version,
        expectedBoardVersion: snapshot.board.version,
        reason: null
      });
      snapshot = reorderCommand.body.snapshot;
      reorderCard = pr05Card(snapshot, pr05TaskTitles.reorder);
      await expect(
        page.getByRole('region', { name: 'Canonical Project Task Kanban' })
          .getByRole('status')
          .filter({ hasText: 'Move saved.' })
      ).toBeVisible();
      await expectPr05StageOrder(page, snapshot, 'Todo');
      expect(pr05StageTaskIds(snapshot, todo.workflowStageId).indexOf(reorderCard.taskId))
        .toBeLessThan(pr05StageTaskIds(snapshot, todo.workflowStageId).indexOf(moveCardBeforeReorder.taskId));

      const reorderReloadResponse = waitForApiResponse(page, 'GET', `/api/projects/${evidence.projectId}/kanban`);
      await page.reload();
      snapshot = await recordOkJson(
        await reorderReloadResponse,
        evidence,
        'pr05-reorder-after-reload',
        isPr05KanbanSnapshot
      ) as Pr05KanbanSnapshotDto;
      await expectPr05StageOrder(page, snapshot, 'Todo');
      evidence.reorderPersistence = {
        taskId: reorderCard.taskId,
        beforeTaskId: moveCardBeforeReorder.taskId,
        boardVersion: snapshot.board.version,
        boardOrder: pr05Card(snapshot, pr05TaskTitles.reorder).boardOrder,
        persistedOrder: pr05StageTaskIds(snapshot, todo.workflowStageId)
      };
      expect(evidence.reorderPersistence.persistedOrder.indexOf(reorderCard.taskId))
        .toBeLessThan(evidence.reorderPersistence.persistedOrder.indexOf(moveCardBeforeReorder.taskId));

      // Canonical cross-Stage move uses the empty neighbor pair as the bounded
      // snapshot-independent "end of Stage" intent.
      let moveCard = pr05Card(snapshot, pr05TaskTitles.move);
      let moveLocator = pr05CardLocator(page, moveCard.taskId);
      await moveLocator.getByRole('button', { name: 'Move', exact: true }).click();
      await moveLocator.getByLabel('Target stage').selectOption(done.workflowStageId);
      await expect(moveLocator.getByLabel('Position')).toHaveValue('end');
      const moveResponsePromise = waitForApiResponse(page, 'POST', `/api/tasks/${moveCard.taskId}/kanban-move`);
      await moveLocator.getByRole('button', { name: 'Apply move' }).click();
      const moveCommand = await recordPr05KanbanCommand(await moveResponsePromise, evidence, 'stage-move-to-done', 200);
      expect(moveCommand.request).toMatchObject({
        targetWorkflowStageId: done.workflowStageId,
        targetBeforeTaskId: null,
        targetAfterTaskId: null,
        expectedTaskVersion: moveCard.version,
        expectedBoardVersion: snapshot.board.version,
        reason: null
      });
      snapshot = moveCommand.body.snapshot;
      moveCard = pr05Card(snapshot, pr05TaskTitles.move);
      await expect(pr05ColumnLocator(page, 'Done').locator(`[data-kanban-card-id="${moveCard.taskId}"]`)).toBeVisible();
      await expect(page.getByText('Move saved.', { exact: true })).toBeVisible();
      await expectPr05StageOrder(page, snapshot, 'Done');

      const moveReloadResponse = waitForApiResponse(page, 'GET', `/api/projects/${evidence.projectId}/kanban`);
      await page.reload();
      snapshot = await recordOkJson(
        await moveReloadResponse,
        evidence,
        'pr05-stage-move-after-reload',
        isPr05KanbanSnapshot
      ) as Pr05KanbanSnapshotDto;
      moveCard = pr05Card(snapshot, pr05TaskTitles.move);
      expect(moveCard.workflowStageId).toBe(done.workflowStageId);
      await expect(pr05ColumnLocator(page, 'Done').locator(`[data-kanban-card-id="${moveCard.taskId}"]`)).toBeVisible();
      evidence.movePersistence = {
        taskId: moveCard.taskId,
        workflowStageId: moveCard.workflowStageId,
        boardVersion: snapshot.board.version,
        taskVersion: moveCard.version,
        boardOrder: moveCard.boardOrder
      };

      // Cancelled requires a reason. Escape and the explicit Cancel button
      // close the interaction, restore focus, and must not dispatch POST.
      let cancellationCard = pr05Card(snapshot, pr05TaskTitles.cancellation);
      let cancellationLocator = pr05CardLocator(page, cancellationCard.taskId);
      const postsBeforeCancellation = kanbanPostCount;
      await cancellationLocator.getByRole('button', { name: 'Move', exact: true }).click();
      await cancellationLocator.getByLabel('Target stage').selectOption(cancelled.workflowStageId);
      await expect(cancellationLocator.getByLabel('Reason')).toBeVisible();
      await expect(cancellationLocator.getByRole('button', { name: 'Apply move' })).toBeDisabled();
      expect(kanbanPostCount).toBe(postsBeforeCancellation);
      await cancellationLocator.getByLabel('Reason').press('Escape');
      await expect(cancellationLocator.getByLabel('Reason')).toHaveCount(0);
      await expect(cancellationLocator).toBeFocused();
      expect(kanbanPostCount).toBe(postsBeforeCancellation);

      await cancellationLocator.getByRole('button', { name: 'Move', exact: true }).click();
      await cancellationLocator.getByLabel('Target stage').selectOption(cancelled.workflowStageId);
      await cancellationLocator.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(cancellationLocator.getByLabel('Reason')).toHaveCount(0);
      await expect(cancellationLocator).toBeFocused();
      expect(kanbanPostCount).toBe(postsBeforeCancellation);

      const cancellationReason = 'Cancelled by the synthetic PR05 real-browser acceptance.';
      await cancellationLocator.getByRole('button', { name: 'Move', exact: true }).click();
      await cancellationLocator.getByLabel('Target stage').selectOption(cancelled.workflowStageId);
      await cancellationLocator.getByLabel('Reason').fill(cancellationReason);
      const cancellationResponsePromise = waitForApiResponse(page, 'POST', `/api/tasks/${cancellationCard.taskId}/kanban-move`);
      await cancellationLocator.getByRole('button', { name: 'Apply move' }).click();
      const cancellationCommand = await recordPr05KanbanCommand(await cancellationResponsePromise, evidence, 'reason-required-cancelled', 200);
      expect(cancellationCommand.request).toMatchObject({
        targetWorkflowStageId: cancelled.workflowStageId,
        targetBeforeTaskId: null,
        targetAfterTaskId: null,
        expectedTaskVersion: cancellationCard.version,
        expectedBoardVersion: snapshot.board.version,
        reason: cancellationReason
      });
      snapshot = cancellationCommand.body.snapshot;
      cancellationCard = pr05Card(snapshot, pr05TaskTitles.cancellation);
      expect(cancellationCard.workflowStageId).toBe(cancelled.workflowStageId);
      await expect(pr05ColumnLocator(page, 'Cancelled').locator(`[data-kanban-card-id="${cancellationCard.taskId}"]`)).toBeVisible();
      await expect(page.getByText('Move saved.', { exact: true })).toBeVisible();
      await expectPr05StageOrder(page, snapshot, 'Cancelled');

      const cancellationReloadResponse = waitForApiResponse(page, 'GET', `/api/projects/${evidence.projectId}/kanban`);
      await page.reload();
      snapshot = await recordOkJson(
        await cancellationReloadResponse,
        evidence,
        'pr05-cancelled-after-reload',
        isPr05KanbanSnapshot
      ) as Pr05KanbanSnapshotDto;
      cancellationCard = pr05Card(snapshot, pr05TaskTitles.cancellation);
      expect(cancellationCard.workflowStageId).toBe(cancelled.workflowStageId);
      await expect(pr05ColumnLocator(page, 'Cancelled').locator(`[data-kanban-card-id="${cancellationCard.taskId}"]`)).toBeVisible();
      await expectPr05StageOrder(page, snapshot, 'Cancelled');
      evidence.reasonRequired = {
        taskId: cancellationCard.taskId,
        escapeSentPost: false,
        cancelSentPost: false,
        focusRestored: true,
        submittedReason: cancellationReason,
        persistedWorkflowStageId: cancellationCard.workflowStageId
      };

      // Hold the UI move form open so a real, separate HTTP move is queued by
      // realtime rather than updating the local snapshot. The subsequent UI
      // POST therefore carries the genuinely stale board version and receives
      // the backend's real 409 response.
      const staleSnapshot = snapshot;
      const conflictCard = pr05Card(staleSnapshot, pr05TaskTitles.conflict);
      const neighborCard = pr05Card(staleSnapshot, pr05TaskTitles.neighbor);
      const conflictLocator = pr05CardLocator(page, conflictCard.taskId);
      await conflictLocator.getByRole('button', { name: 'Move', exact: true }).click();
      await conflictLocator.getByLabel('Target stage').selectOption(done.workflowStageId);

      const directNeighborIntent = {
        targetWorkflowStageId: todo.workflowStageId,
        targetBeforeTaskId: null,
        targetAfterTaskId: null,
        expectedTaskVersion: neighborCard.version,
        expectedBoardVersion: staleSnapshot.board.version,
        reason: null
      };
      const directNeighborMove = await requestWithCsrf(
        page,
        'POST',
        `/api/tasks/${neighborCard.taskId}/kanban-move`,
        directNeighborIntent
      );
      expect(directNeighborMove.status, directNeighborMove.text).toBe(200);
      expect(directNeighborMove.csrfHeaderPresent, 'direct concurrent mutation includes the real CSRF header').toBe(true);
      const concurrentSnapshot = (parseJson(directNeighborMove.text) as Pr05KanbanCommandResponseDto).snapshot;
      expect(isPr05KanbanSnapshot(concurrentSnapshot), 'direct mutation authoritative snapshot').toBe(true);
      expect(concurrentSnapshot.board.version).toBeGreaterThan(staleSnapshot.board.version);
      evidence.commands.push({
        name: 'concurrent-real-reorder',
        responseUrl: new URL(`/api/tasks/${neighborCard.taskId}/kanban-move`, page.url()).href,
        status: directNeighborMove.status,
        taskId: neighborCard.taskId,
        expectedTaskVersion: neighborCard.version,
        expectedBoardVersion: staleSnapshot.board.version,
        authoritativeBoardVersion: concurrentSnapshot.board.version,
        targetWorkflowStageId: todo.workflowStageId,
        targetBeforeTaskId: null,
        targetAfterTaskId: null,
        csrfHeaderPresent: directNeighborMove.csrfHeaderPresent
      });
      await expect(page.getByText('A live update is queued until the active board operation ends.', { exact: true }))
        .toBeVisible({ timeout: 30_000 });

      const stalePostResponsePromise = waitForApiResponse(page, 'POST', `/api/tasks/${conflictCard.taskId}/kanban-move`);
      const authoritativeRefetchPromise = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === `/api/projects/${evidence.projectId}/kanban` &&
        response.status() === 200
      );
      await page.evaluate((taskId) => {
        const state = { transitions: [] as string[], observer: null as MutationObserver | null };
        const recordStage = () => {
          const card = document.querySelector(`[data-kanban-card-id="${taskId}"]`);
          const stage = card?.closest('.aip-kanban__column')?.querySelector('h3')?.textContent?.trim();
          if (stage && state.transitions.at(-1) !== stage) state.transitions.push(stage);
        };
        recordStage();
        state.observer = new MutationObserver(recordStage);
        state.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        (window as Window & { __pr05ConflictStageObserver?: typeof state }).__pr05ConflictStageObserver = state;
      }, conflictCard.taskId);
      await conflictLocator.getByRole('button', { name: 'Apply move' }).click();
      const conflictCommand = await recordPr05KanbanCommand(await stalePostResponsePromise, evidence, 'stale-board-conflict', 409);
      expect(conflictCommand.request).toMatchObject({
        targetWorkflowStageId: done.workflowStageId,
        targetBeforeTaskId: null,
        targetAfterTaskId: null,
        expectedTaskVersion: conflictCard.version,
        expectedBoardVersion: staleSnapshot.board.version,
        reason: null
      });
      expect(conflictCommand.body.error?.code).toBe('KANBAN_STALE_BOARD');
      expect(JSON.stringify(conflictCommand.body), '409 denial does not disclose protected records').not.toMatch(
        /tenantId|workspaceId|PR05 stable neighbor card|browser-smoke-pr04-queue/i
      );
      snapshot = await recordOkJson(
        await authoritativeRefetchPromise,
        evidence,
        'pr05-conflict-authoritative-refetch',
        isPr05KanbanSnapshot
      ) as Pr05KanbanSnapshotDto;
      await expect(
        page.getByRole('region', { name: 'Canonical Project Task Kanban' })
          .getByRole('status')
          .filter({ hasText: 'Conflict resolved from the authoritative Project board.' })
      ).toBeVisible();
      await expect(pr05ColumnLocator(page, 'Todo').locator(`[data-kanban-card-id="${conflictCard.taskId}"]`)).toBeVisible();
      await expect(pr05CardLocator(page, conflictCard.taskId)).toBeFocused();
      await expectPr05StageOrder(page, snapshot, 'Todo');
      expect(pr05StageTaskIds(snapshot, todo.workflowStageId).at(-1)).toBe(neighborCard.taskId);
      const optimisticStageTransitions = await page.evaluate(() => {
        const state = (window as Window & {
          __pr05ConflictStageObserver?: { transitions: string[]; observer: MutationObserver | null };
        }).__pr05ConflictStageObserver;
        state?.observer?.disconnect();
        return state?.transitions ?? [];
      });
      const optimisticDoneIndex = optimisticStageTransitions.indexOf('Done');
      expect(optimisticDoneIndex, 'the stale command first renders the optimistic Done state').toBeGreaterThan(-1);
      expect(
        optimisticStageTransitions.slice(optimisticDoneIndex + 1),
        'the real 409 rolls the optimistic card back to Todo'
      ).toContain('Todo');
      evidence.staleConflict = {
        taskId: conflictCard.taskId,
        staleTaskVersion: conflictCard.version,
        staleBoardVersion: staleSnapshot.board.version,
        concurrentBoardVersion: concurrentSnapshot.board.version,
        status: conflictCommand.response.status(),
        code: conflictCommand.body.error?.code,
        refetchedBoardVersion: snapshot.board.version,
        rolledBackWorkflowStageId: pr05Card(snapshot, pr05TaskTitles.conflict).workflowStageId,
        optimisticStageTransitions,
        focusRestored: true
      };

      // Start observing before revocation. Racing this protected-DOM clear
      // against the real 404 proves the authorization event clears the
      // snapshot before HTTP revalidation completes.
      const protectedDataClear = page.evaluate((protectedTitles) =>
        new Promise<'protected-data-cleared'>((resolve) => {
          const isClear = () => {
            const text = document.body.innerText;
            return document.querySelectorAll('[data-kanban-card-id]').length === 0 &&
              protectedTitles.every((title) => !text.includes(title));
          };
          if (isClear()) {
            resolve('protected-data-cleared');
            return;
          }

          const observer = new MutationObserver(() => {
            if (!isClear()) return;
            observer.disconnect();
            resolve('protected-data-cleared');
          });
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }), Object.values(pr05TaskTitles));

      ownerContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL ?? '') });
      const ownerPage = await ownerContext.newPage();
      const ownerEvidence: SmokeEvidence = {
        baseURL: evidence.baseURL,
        email: smokeEmail,
        steps: [],
        pageErrors: [],
        consoleErrors: [],
        failedApiResponses: []
      };
      await loginAndVerifySession(ownerPage, ownerEvidence);
      expect(ownerEvidence.userId, 'the revoking Owner is a separate synthetic actor').not.toBe(evidence.userId);

      // The Test-only one-shot response gate holds delivery only after the
      // real controller has produced an authorized 200. Authorization,
      // persistence, response content, and the browser request stay real.
      const responseGateId = randomUUID().replaceAll('-', '');
      const gatedKanbanPath = `/api/projects/${evidence.projectId}/kanban`;
      const gateArm = await requestWithCsrf(
        page,
        'POST',
        `${pr05ResponseGatePath}/${responseGateId}/arm`,
        { method: 'GET', path: gatedKanbanPath }
      );
      expect(gateArm.status, gateArm.text).toBe(200);
      expect(gateArm.csrfHeaderPresent, 'response gate arm uses the real CSRF middleware').toBe(true);
      await page.context().addCookies([{
        name: pr05ResponseGateCookieName,
        value: responseGateId,
        url: new URL('/', page.url()).href
      }]);

      const refreshRequest = page.waitForRequest((request) =>
        request.method() === 'GET' &&
        new URL(request.url()).pathname === gatedKanbanPath
      );
      const heldAuthorizedRefreshResponse = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === gatedKanbanPath &&
        response.status() === 200 &&
        response.headers()[pr05ResponseGateHeaderName] === responseGateId
      );
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await refreshRequest;
      await expect.poll(async () => {
        const gate = await fetchJsonFromPage(page, `${pr05ResponseGatePath}/${responseGateId}`);
        return gate.status === 200 ? gate.body : { state: `HTTP ${gate.status}`, statusCode: null };
      }, {
        message: 'the real authorized Kanban response reaches the one-shot response gate',
        timeout: 10_000
      }).toMatchObject({ state: 'waiting', statusCode: 200 });

      const deniedRefreshResponse = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === gatedKanbanPath &&
        response.status() === 404
      );
      const projectDetailPath = `/api/projects/${evidence.projectId}`;
      const deniedProjectDetailResponse = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === projectDetailPath
      );
      const firstRevocationObservationPromise = Promise.race([
        protectedDataClear,
        deniedRefreshResponse.then(() => 'denial-response' as const)
      ]);
      const revoke = await requestWithCsrf(
        ownerPage,
        'DELETE',
        `/api/projects/${evidence.projectId}/members/${evidence.userId}`
      );
      expect(revoke.status, revoke.text).toBe(200);
      expect(revoke.csrfHeaderPresent, 'Owner revocation includes a real CSRF header').toBe(true);

      const firstRevocationObservation = await firstRevocationObservationPromise;
      expect(firstRevocationObservation, 'protected board DOM is cleared before the denial response arrives')
        .toBe('protected-data-cleared');
      const deniedResponse = await deniedRefreshResponse;
      const deniedText = await deniedResponse.text();
      evidence.steps.push({
        name: 'pr05-authorization-state-safe-kanban-denial',
        method: 'GET',
        path: new URL(deniedResponse.url()).pathname,
        status: deniedResponse.status(),
        bodyPreview: preview(deniedText)
      });
      expectCanonicalKanbanDenial(deniedText, 'KANBAN_NOT_FOUND');
      const deniedProjectResponse = await deniedProjectDetailResponse;
      const deniedProjectText = await deniedProjectResponse.text();
      const expectedProjectDetailDenial: SmokeFailedApiResponse = {
        method: deniedProjectResponse.request().method(),
        path: new URL(deniedProjectResponse.url()).pathname,
        status: deniedProjectResponse.status()
      };
      evidence.steps.push({
        name: 'pr05-project-detail-safe-denial-after-revocation',
        method: expectedProjectDetailDenial.method,
        path: expectedProjectDetailDenial.path,
        status: expectedProjectDetailDenial.status,
        bodyPreview: preview(deniedProjectText)
      });
      const deniedProjectBody = expectSafeProjectDetailDenial(deniedProjectText, [
        evidence.projectId!, evidence.tenantId!, evidence.workspaceId!, pr05ProjectTitle,
        ...Object.values(pr05TaskTitles)
      ]);
      expect(deniedProjectResponse.status(), 'revoked Project detail uses the established safe denial contract')
        .toBe(400);
      expect(evidence.failedApiResponses).toContainEqual(expectedProjectDetailDenial);
      await expect(page.getByRole('status', {
        name: 'Project access was denied during reconnect. Protected Project data was cleared.',
        exact: true
      })).toBeVisible();
      await expect(page.locator('[data-kanban-card-id]')).toHaveCount(0);
      await expect(page.locator('.aip-kanban__column')).toHaveCount(0);
      await expect(page.getByText('Warning: WIP limit 4 exceeded.', { exact: true })).toHaveCount(0);
      for (const title of Object.values(pr05TaskTitles)) {
        await expect(page.getByText(title, { exact: true })).toHaveCount(0);
      }
      await expect(page.locator('body')).not.toContainText(/Parent:|Derived progress:|Derived dates:/);
      await expect(page.locator('body')).not.toContainText(evidence.tenantId!);
      await expect(page.locator('body')).not.toContainText(evidence.workspaceId!);
      await expect(page.locator('body')).not.toContainText('Security.AuthorizationStateChanged.v1');

      await page.evaluate((protectedTitles) => {
        const state = { restored: false, observer: null as MutationObserver | null };
        const observeProtectedData = () => {
          const text = document.body.innerText;
          if (
            document.querySelectorAll('[data-kanban-card-id]').length > 0 ||
            protectedTitles.some((title) => text.includes(title))
          ) {
            state.restored = true;
          }
        };
        state.observer = new MutationObserver(observeProtectedData);
        state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        (window as Window & { __pr05RevocationObserver?: typeof state }).__pr05RevocationObserver = state;
        observeProtectedData();
      }, Object.values(pr05TaskTitles));

      const gateRelease = await requestWithCsrf(
        page,
        'POST',
        `${pr05ResponseGatePath}/${responseGateId}/release`
      );
      expect(gateRelease.status, gateRelease.text).toBe(200);
      expect(gateRelease.csrfHeaderPresent, 'response gate release uses the real CSRF middleware').toBe(true);
      const staleAuthorizedResponse = await heldAuthorizedRefreshResponse;
      expect(staleAuthorizedResponse.status()).toBe(200);
      expect(await staleAuthorizedResponse.finished(), 'the held real 200 finishes after protected data was cleared')
        .toBeNull();
      evidence.steps.push({
        name: 'pr05-stale-authorized-kanban-response-after-revocation',
        method: 'GET',
        path: new URL(staleAuthorizedResponse.url()).pathname,
        status: staleAuthorizedResponse.status()
      });
      await page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const protectedDataRestoredByStaleResponse = await page.evaluate(() => {
        const state = (window as Window & {
          __pr05RevocationObserver?: { restored: boolean; observer: MutationObserver | null };
        }).__pr05RevocationObserver;
        state?.observer?.disconnect();
        return state?.restored ?? true;
      });
      expect(
        protectedDataRestoredByStaleResponse,
        'the stale authorized 200 must not repopulate protected board DOM'
      ).toBe(false);
      await expect(page.locator('[data-kanban-card-id]')).toHaveCount(0);

      const subsequentDenial = await fetchFromPage(page, `/api/projects/${evidence.projectId}/kanban`);
      evidence.steps.push({
        name: 'pr05-subsequent-kanban-safe-denial',
        method: 'GET',
        path: `/api/projects/${evidence.projectId}/kanban`,
        status: subsequentDenial.status,
        bodyPreview: preview(subsequentDenial.text)
      });
      expect(subsequentDenial.status).toBe(404);
      expectCanonicalKanbanDenial(subsequentDenial.text, 'KANBAN_NOT_FOUND');
      await expect(page.locator('[data-kanban-card-id]')).toHaveCount(0);
      evidence.authorizationRevocation = {
        revokingActorUserId: ownerEvidence.userId!,
        revokedUserId: evidence.userId!,
        revokeStatus: revoke.status,
        csrfHeaderPresent: revoke.csrfHeaderPresent,
        overlappingRefreshStatus: staleAuthorizedResponse.status(),
        projectDetailDenialStatus: deniedProjectResponse.status(),
        projectDetailDenialCode: String(deniedProjectBody.code),
        staleAuthorizedResponseUrl: staleAuthorizedResponse.url(),
        responseGateStatusCode: 200,
        denialUrl: deniedResponse.url(),
        denialStatus: deniedResponse.status(),
        subsequentDenialStatus: subsequentDenial.status,
        protectedDataClearedBeforeRevalidation: firstRevocationObservation === 'protected-data-cleared',
        protectedDataRestoredByStaleResponse
      };

      expect(kanbanPostCount, 'real browser and direct concurrency Kanban POST count').toBe(5);
      expect(evidence.pageErrors, 'browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(evidence, [expectedProjectDetailDenial]);
      expectUnexpectedApiFailures(evidence, [expectedProjectDetailDenial]);
    } finally {
      await ownerContext?.close();
      await testInfo.attach('task-v1-pr05-real-backend-evidence.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json'
      });
    }
  });

  test('TASK-V1-PR06 exercises canonical Gantt commands, rollback, degradation, and revocation through PostgreSQL', async ({ page, browser }, testInfo) => {
    const evidence: Pr06GanttEvidence = {
      baseURL: String(testInfo.project.use.baseURL ?? ''),
      email: pr05ManagerEmail,
      steps: [],
      pageErrors: [],
      consoleErrors: [],
      failedApiResponses: [],
      seed: {
        projectSlug: pr06ProjectSlug,
        projectTitle: pr06ProjectTitle,
        taskTitles: Object.values(pr06TaskTitles),
        milestoneTitle: pr06MilestoneTitle
      },
      apiInterception: 'none',
      hubTransportFaultInjection: 'A separate authenticated browser context rejects only /hubs/app transport; all /api HTTP remains real.',
      commands: []
    };
    let ownerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    let degradedContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    let viewerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;

    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
    page.on('response', (response) => recordFailedApiResponse(response, evidence));

    try {
      await loginAndVerifySession(page, evidence, { email: pr05ManagerEmail, password: smokePassword });
      await expect(page.getByTestId('realtime-connection-state')).toContainText('Realtime updates connected.', { timeout: 30_000 });

      const featureEnabled = await page.evaluate(() =>
        (window as Window & { __AIP_FEATURE_FLAGS__?: Record<string, boolean> })
          .__AIP_FEATURE_FLAGS__?.['tasks.ganttV1'] === true);
      evidence.featureFlagEnabled = featureEnabled;
      expect(featureEnabled, 'the hosted runtime config enables the PR06 Schedule presentation').toBe(true);

      const projects = await recordFetchJson(page, evidence, 'pr06-projects', '/api/projects?page=1&pageSize=100', {
        validate: (body) => isPagedResponse(body) &&
          body.items.some((item: unknown) => hasStringValue(item, 'title', pr06ProjectTitle))
      }) as Record<string, any>;
      const project = projects.items.find((item: Record<string, unknown>) => item.title === pr06ProjectTitle)!;
      evidence.projectId = String(project.id);
      evidence.workspaceId = String(project.workspaceId);
      expect(evidence.projectId, 'synthetic PR06 Project id').toMatch(/^[0-9a-f-]{36}$/i);
      expect(evidence.workspaceId, 'synthetic PR06 Workspace id').toMatch(/^[0-9a-f-]{36}$/i);
      expect(
        String(project.groupId),
        'the PR06 revocation fixture is group-scoped so removing Project membership revokes view access'
      ).toMatch(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f-]{36}$/i);

      const members = await recordFetchJson(
        page,
        evidence,
        'pr06-project-members',
        `/api/projects/${evidence.projectId}/members`,
        {
          validate: (body) => Array.isArray(body) &&
            body.some((member: unknown) => hasStringValue(member, 'email', pr05ManagerEmail)) &&
            body.some((member: unknown) => hasStringValue(member, 'email', pr06ViewerEmail)) &&
            body.some((member: unknown) => hasStringValue(member, 'email', smokeEmail))
        }
      ) as Record<string, any>[];
      const managerMember = members.find((member) => member.email === pr05ManagerEmail)!;
      const viewerMember = members.find((member) => member.email === pr06ViewerEmail)!;
      const ownerMember = members.find((member) => member.email === smokeEmail)!;
      expect(String(managerMember.userId)).toBe(evidence.userId);
      expect(String(viewerMember.userId)).not.toBe(evidence.userId);
      expect(String(ownerMember.userId)).not.toBe(evidence.userId);

      const ganttPath = `/api/projects/${evidence.projectId}/gantt`;
      const initialSnapshotResponse = waitForApiResponse(page, 'GET', ganttPath);
      await page.goto(`/app/projects/${evidence.projectId}`);
      let snapshot = await recordOkJson(
        await initialSnapshotResponse,
        evidence,
        'pr06-initial-gantt-snapshot',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;

      const initialItems = Object.fromEntries(
        Object.entries(pr06TaskTitles).map(([key, title]) => [key, pr06GanttItem(snapshot, title)])
      ) as Record<keyof typeof pr06TaskTitles, Pr06GanttItemDto>;
      const milestone = pr06GanttItem(snapshot, pr06MilestoneTitle);
      const allInitialIds = [
        ...snapshot.scheduledItems,
        ...snapshot.unscheduledItems,
        ...snapshot.milestones
      ].map((item) => item.taskId);
      expect(new Set(allInitialIds).size, 'snapshot must not duplicate canonical WorkItems').toBe(allInitialIds.length);
      expect(snapshot.totalItems).toBe(allInitialIds.length);
      expect(snapshot.totalItems).toBeLessThanOrEqual(snapshot.maximumItems);
      expect(snapshot.calendar.timeZone, 'the server returns an actual Workspace timezone identifier').toBeTruthy();
      expect(snapshot.calendar.holidaysAvailable).toBe(false);
      expect(snapshot.calendar.limitations.length).toBeGreaterThan(0);
      expect(snapshot.permissions).toMatchObject({
        canEditSchedule: true,
        canEditProgress: true,
        canManageDependencies: true,
        canClearSchedule: true,
        canOpen: true
      });
      expect(initialItems.parent.progressIsDerived).toBe(true);
      expect(initialItems.parent.warnings.some((warning) => warning.code === 'PARENT_DERIVED')).toBe(true);
      expect(initialItems.parent.scheduleEditPermissions).toMatchObject({
        canEditSchedule: false,
        canEditProgress: false,
        canClearSchedule: false
      });
      expect(initialItems.unscheduled.warnings.some((warning) => warning.code === 'UNSCHEDULED')).toBe(true);
      expect(milestone.kind).toBe('Milestone');
      expect(milestone.milestoneDate).toBeTruthy();
      expect(milestone.plannedStartDate).toBeNull();
      expect(milestone.plannedEndDate).toBeNull();
      expect(snapshot.dependencies.some((dependency) =>
        dependency.type === 'FinishToStart' && dependency.editable)).toBe(true);
      expect(snapshot.dependencies.some((dependency) =>
        dependency.type !== 'FinishToStart' &&
        dependency.editable === false &&
        dependency.warnings.some((warning) => warning.code === 'LEGACY_DEPENDENCY_TYPE'))).toBe(true);
      expect(snapshot.warnings.some((warning) => warning.code === 'DEPENDENCY_VIOLATION')).toBe(true);

      viewerContext = await browser.newContext({ baseURL: evidence.baseURL });
      const viewerPage = await viewerContext.newPage();
      const viewerEvidence: SmokeEvidence = {
        baseURL: evidence.baseURL,
        email: pr06ViewerEmail,
        steps: [],
        pageErrors: [],
        consoleErrors: [],
        failedApiResponses: []
      };
      viewerPage.on('pageerror', (error) => viewerEvidence.pageErrors.push(error.message));
      viewerPage.on('console', (message) => {
        if (message.type() === 'error') viewerEvidence.consoleErrors.push(message.text());
      });
      viewerPage.on('response', (response) => recordFailedApiResponse(response, viewerEvidence));
      await loginAndVerifySession(
        viewerPage,
        viewerEvidence,
        { email: pr06ViewerEmail, password: `${smokePassword}:recipient` }
      );
      expect(viewerEvidence.userId).toBe(String(viewerMember.userId));
      const viewerSnapshotPromise = waitForApiResponse(viewerPage, 'GET', ganttPath);
      await viewerPage.goto(`/app/projects/${evidence.projectId}`);
      const viewerSnapshotResponse = await viewerSnapshotPromise;
      const viewerSnapshot = await recordOkJson(
        viewerSnapshotResponse,
        viewerEvidence,
        'pr06-viewer-gantt-snapshot',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      expect(viewerSnapshot.permissions).toMatchObject({
        canEditSchedule: false,
        canEditProgress: false,
        canManageDependencies: false,
        canClearSchedule: false,
        canOpen: true
      });
      expect([
        ...viewerSnapshot.scheduledItems,
        ...viewerSnapshot.unscheduledItems,
        ...viewerSnapshot.milestones
      ].every((item) =>
        !item.scheduleEditPermissions.canEditSchedule &&
        !item.scheduleEditPermissions.canEditProgress &&
        !item.scheduleEditPermissions.canManageDependencies &&
        !item.scheduleEditPermissions.canClearSchedule
      ), 'viewer item permissions remain read-only').toBe(true);
      expect(
        viewerSnapshot.dependencies.every((dependency) => !dependency.editable),
        'viewer dependency permissions remain read-only'
      ).toBe(true);
      await viewerPage.getByRole('tab', { name: 'Schedule', exact: true }).click();
      await expect(viewerPage.getByText('Schedule is read-only for the current actor.')).toBeVisible();
      const viewerEditActions = viewerPage.getByRole('button', {
        name: /^(Edit dates|Edit Milestone date|Edit progress|Move to unscheduled|Add FS predecessor|Remove FS dependency)$/
      });
      await expect(viewerEditActions).toHaveCount(0);
      expect(viewerEvidence.pageErrors, 'viewer browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(viewerEvidence);
      expectUnexpectedApiFailures(viewerEvidence);
      evidence.viewerReadOnly = {
        userId: viewerEvidence.userId!,
        snapshotStatus: viewerSnapshotResponse.status(),
        permissions: viewerSnapshot.permissions,
        editActionCount: 0,
        pageErrors: [...viewerEvidence.pageErrors],
        consoleErrors: [...viewerEvidence.consoleErrors],
        failedApiResponses: [...viewerEvidence.failedApiResponses]
      };
      await viewerContext.close();
      viewerContext = null;

      const canonicalTasks = await recordFetchJson(
        page,
        evidence,
        'pr06-shared-canonical-task-list',
        `/api/projects/${evidence.projectId}/tasks?page=1&pageSize=100`,
        {
          validate: (body) => isPagedResponse(body) &&
            Object.values(pr06TaskTitles).every((title) =>
              body.items.some((item: unknown) => hasStringValue(item, 'title', title)))
        }
      ) as Record<string, any>;
      const canonicalTaskIds = new Set(canonicalTasks.items.map((item: Record<string, unknown>) => String(item.id)));
      expect(Object.values(initialItems).every((item) => canonicalTaskIds.has(item.taskId)),
        'Gantt Task rows use the same canonical TaskItem ids as Project List').toBe(true);

      await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
      await expect(page.getByTestId('project-schedule')).toBeVisible();
      await expect(page.getByTestId('aip-gantt-projection')).toBeVisible();
      await expect(page.getByText(`Workspace timezone:`)).toContainText(snapshot.calendar.timeZone);
      await expect(pr06GanttItemLocator(page, initialItems.parent.taskId)).toContainText('Derived parent Task');
      await expect(pr06GanttItemLocator(page, initialItems.parent.taskId)
        .getByRole('button', { name: /Edit dates|Edit progress|Move to unscheduled/ })).toHaveCount(0);
      const scheduleWarnings = page.getByRole('region', { name: 'Schedule warnings', exact: true });
      await expect(scheduleWarnings).toContainText('DEPENDENCY_VIOLATION');
      await expect(scheduleWarnings).toContainText('LEGACY_DEPENDENCY_TYPE');

      const scheduleDetailBefore = await recordFetchJson(
        page,
        evidence,
        'pr06-schedule-task-before',
        `/api/tasks/${initialItems.schedule.taskId}`,
        { validate: (body) => taskDetailVersion(body) === initialItems.schedule.version && taskDeadlineAt(body) !== null }
      ) as Record<string, any>;
      const deadlineAtBefore = taskDeadlineAt(scheduleDetailBefore);
      const predecessorDatesBefore = {
        plannedStartDate: initialItems.predecessor.plannedStartDate,
        plannedEndDate: initialItems.predecessor.plannedEndDate
      };

      let scheduleLocator = pr06GanttItemLocator(page, initialItems.schedule.taskId);
      await scheduleLocator.getByRole('button', { name: 'Edit dates', exact: true }).click();
      await page.getByLabel('Planned start').fill('2031-03-01');
      await page.getByLabel('Planned end').fill('2031-03-05');
      const scheduleCommandResponse = waitForApiResponse(page, 'PATCH', `/api/tasks/${initialItems.schedule.taskId}/schedule`);
      const scheduleRefetchResponse = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.getByRole('button', { name: 'Apply schedule', exact: true }).click();
      const scheduleCommand = await recordPr06Command(
        await scheduleCommandResponse,
        evidence,
        'manual-schedule-update',
        200
      );
      expect(scheduleCommand.request).toMatchObject({
        plannedStartDate: '2031-03-01',
        plannedEndDate: '2031-03-05',
        milestoneDate: null,
        expectedVersion: initialItems.schedule.version
      });
      snapshot = await recordOkJson(
        await scheduleRefetchResponse,
        evidence,
        'pr06-schedule-update-authoritative-refetch',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      let scheduleTask = pr06GanttItem(snapshot, pr06TaskTitles.schedule);
      expect(scheduleTask.plannedStartDate).toBe('2031-03-01');
      expect(scheduleTask.plannedEndDate).toBe('2031-03-05');
      expect(scheduleTask.version).toBeGreaterThan(initialItems.schedule.version);
      const predecessorAfterSchedule = pr06GanttItem(snapshot, pr06TaskTitles.predecessor);
      expect({
        plannedStartDate: predecessorAfterSchedule.plannedStartDate,
        plannedEndDate: predecessorAfterSchedule.plannedEndDate
      }, 'manual schedule edits do not cascade to dependency neighbors').toEqual(predecessorDatesBefore);
      await expect(pr06GanttItemLocator(page, scheduleTask.taskId)).toContainText('2031-03-01 to 2031-03-05');
      await expectLogicalPr06GanttFocus(pr06GanttItemLocator(page, scheduleTask.taskId));

      const scheduleDetailAfter = await recordFetchJson(
        page,
        evidence,
        'pr06-schedule-task-after',
        `/api/tasks/${scheduleTask.taskId}`,
        {
          validate: (body) =>
            taskDetailVersion(body) === scheduleTask.version &&
            taskDeadlineAt(body) === deadlineAtBefore
        }
      );
      expect(taskDeadlineAt(scheduleDetailAfter), 'Gantt movement must not change DeadlineAt').toBe(deadlineAtBefore);

      const milestoneBefore = pr06GanttItem(snapshot, pr06MilestoneTitle);
      await pr06GanttItemLocator(page, milestoneBefore.taskId)
        .getByRole('button', { name: 'Edit Milestone date', exact: true }).click();
      await page.getByRole('dialog', { name: 'Edit Milestone date' })
        .locator('input[name="milestoneDate"]')
        .fill('2031-03-20');
      const milestoneCommandResponse = waitForApiResponse(page, 'PATCH', `/api/tasks/${milestoneBefore.taskId}/schedule`);
      const milestoneRefetchResponse = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.getByRole('button', { name: 'Apply schedule', exact: true }).click();
      const milestoneCommand = await recordPr06Command(
        await milestoneCommandResponse,
        evidence,
        'manual-milestone-date-update',
        200
      );
      expect(milestoneCommand.request).toMatchObject({
        plannedStartDate: null,
        plannedEndDate: null,
        milestoneDate: '2031-03-20',
        expectedVersion: milestoneBefore.version
      });
      snapshot = await recordOkJson(
        await milestoneRefetchResponse,
        evidence,
        'pr06-milestone-authoritative-refetch',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      const milestoneAfter = pr06GanttItem(snapshot, pr06MilestoneTitle);
      expect(milestoneAfter.milestoneDate).toBe('2031-03-20');
      expect(milestoneAfter.plannedStartDate).toBeNull();
      expect(milestoneAfter.plannedEndDate).toBeNull();

      let progressTask = pr06GanttItem(snapshot, pr06TaskTitles.predecessor);
      await pr06GanttItemLocator(page, progressTask.taskId)
        .getByRole('button', { name: 'Edit progress', exact: true }).click();
      await page.getByLabel('Progress percent').fill('35');
      const progressCommandResponse = waitForApiResponse(page, 'PATCH', `/api/tasks/${progressTask.taskId}/progress`);
      const progressRefetchResponse = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.getByRole('button', { name: 'Apply progress', exact: true }).click();
      const progressCommand = await recordPr06Command(
        await progressCommandResponse,
        evidence,
        'manual-leaf-progress-update',
        200
      );
      expect(progressCommand.request).toMatchObject({
        progressPercent: 35,
        expectedVersion: progressTask.version
      });
      snapshot = await recordOkJson(
        await progressRefetchResponse,
        evidence,
        'pr06-progress-authoritative-refetch',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      progressTask = pr06GanttItem(snapshot, pr06TaskTitles.predecessor);
      expect(progressTask.progressPercent).toBe(35);
      await expect(pr06GanttItemLocator(page, progressTask.taskId)).toContainText('35%');

      let successor = pr06GanttItem(snapshot, pr06TaskTitles.successor);
      const successorDatesBeforeDependency = {
        plannedStartDate: successor.plannedStartDate,
        plannedEndDate: successor.plannedEndDate
      };
      const dependencyPredecessor = pr06GanttItem(snapshot, pr06TaskTitles.predecessor);
      await pr06GanttItemLocator(page, successor.taskId)
        .getByRole('button', { name: 'Add FS predecessor', exact: true }).click();
      await page.getByLabel('Finish-to-Start predecessor').selectOption(dependencyPredecessor.taskId);
      const dependencyAddResponse = waitForApiResponse(page, 'POST', `/api/tasks/${successor.taskId}/dependencies`);
      const dependencyAddRefetch = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.getByRole('button', { name: 'Add dependency', exact: true }).click();
      const dependencyAdd = await recordPr06Command(
        await dependencyAddResponse,
        evidence,
        'fs-dependency-add',
        200
      );
      expect(dependencyAdd.request).toMatchObject({
        predecessorTaskId: dependencyPredecessor.taskId,
        dependencyType: 'FinishToStart',
        expectedVersion: successor.version
      });
      snapshot = await recordOkJson(
        await dependencyAddRefetch,
        evidence,
        'pr06-dependency-add-authoritative-refetch',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      const addedDependency = snapshot.dependencies.find((dependency) =>
        dependency.predecessorTaskId === dependencyPredecessor.taskId &&
        dependency.successorTaskId === successor.taskId);
      expect(addedDependency, 'the real FS dependency appears in the authoritative snapshot').toBeTruthy();
      expect(addedDependency!.type).toBe('FinishToStart');
      expect(addedDependency!.editable).toBe(true);
      const successorAfterDependency = pr06GanttItem(snapshot, pr06TaskTitles.successor);
      const successorDatesAfterDependency = {
        plannedStartDate: successorAfterDependency.plannedStartDate,
        plannedEndDate: successorAfterDependency.plannedEndDate
      };
      expect(
        successorDatesAfterDependency,
        'adding an FS dependency must not automatically move the successor'
      ).toEqual(successorDatesBeforeDependency);
      evidence.dependencyNoCascade = {
        successorTaskId: successor.taskId,
        before: successorDatesBeforeDependency,
        after: successorDatesAfterDependency
      };
      await expect(page.locator(`[data-gantt-dependency-id="${addedDependency!.dependencyId}"]`)).toBeVisible();

      successor = pr06GanttItem(snapshot, pr06TaskTitles.successor);
      const dependencyLocator = page.locator(`[data-gantt-dependency-id="${addedDependency!.dependencyId}"]`);
      await dependencyLocator.getByRole('button', { name: 'Remove FS dependency', exact: true }).click();
      const dependencyDeleteResponse = waitForApiResponse(
        page,
        'DELETE',
        `/api/tasks/${successor.taskId}/dependencies/${addedDependency!.dependencyId}`
      );
      const dependencyDeleteRefetch = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.getByRole('button', { name: 'Remove dependency', exact: true }).click();
      const dependencyDelete = await recordPr06Command(
        await dependencyDeleteResponse,
        evidence,
        'fs-dependency-remove',
        200
      );
      expect(new URL(dependencyDelete.response.url()).searchParams.get('expectedVersion'))
        .toBe(String(successor.version));
      snapshot = await recordOkJson(
        await dependencyDeleteRefetch,
        evidence,
        'pr06-dependency-remove-authoritative-refetch',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      expect(snapshot.dependencies.some((dependency) => dependency.dependencyId === addedDependency!.dependencyId)).toBe(false);
      await expect(page.locator(`[data-gantt-dependency-id="${addedDependency!.dependencyId}"]`)).toHaveCount(0);

      scheduleTask = pr06GanttItem(snapshot, pr06TaskTitles.schedule);
      scheduleLocator = pr06GanttItemLocator(page, scheduleTask.taskId);
      await scheduleLocator.getByRole('button', { name: 'Move to unscheduled', exact: true }).click();
      const clearCommandResponse = waitForApiResponse(page, 'PATCH', `/api/tasks/${scheduleTask.taskId}/schedule`);
      const clearRefetchResponse = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.getByRole('button', { name: 'Clear schedule', exact: true }).click();
      const clearCommand = await recordPr06Command(
        await clearCommandResponse,
        evidence,
        'manual-schedule-clear',
        200
      );
      expect(clearCommand.request).toMatchObject({
        plannedStartDate: null,
        plannedEndDate: null,
        milestoneDate: null,
        expectedVersion: scheduleTask.version
      });
      snapshot = await recordOkJson(
        await clearRefetchResponse,
        evidence,
        'pr06-schedule-clear-authoritative-refetch',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      scheduleTask = pr06GanttItem(snapshot, pr06TaskTitles.schedule);
      expect(snapshot.unscheduledItems.some((item) => item.taskId === scheduleTask.taskId)).toBe(true);
      expect(scheduleTask.warnings.some((warning) => warning.code === 'UNSCHEDULED')).toBe(true);
      await expect(page.getByRole('heading', { name: 'Unscheduled work', exact: true })
        .locator('..')
        .locator(`[data-gantt-item-id="${scheduleTask.taskId}"]`)).toBeVisible();

      degradedContext = await browser.newContext({ baseURL: evidence.baseURL });
      await degradedContext.addInitScript(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (new URL(url, window.location.href).pathname.startsWith('/hubs/app')) {
            return Promise.reject(new TypeError('Synthetic PR06 Hub unavailability'));
          }
          return nativeFetch(input, init);
        };
      });
      const degradedPage = await degradedContext.newPage();
      const degradedEvidence: SmokeEvidence = {
        baseURL: evidence.baseURL,
        email: pr05ManagerEmail,
        steps: [],
        pageErrors: [],
        consoleErrors: [],
        failedApiResponses: []
      };
      degradedPage.on('pageerror', (error) => degradedEvidence.pageErrors.push(error.message));
      degradedPage.on('console', (message) => {
        if (message.type() === 'error') degradedEvidence.consoleErrors.push(message.text());
      });
      degradedPage.on('response', (response) => recordFailedApiResponse(response, degradedEvidence));
      await loginAndVerifySession(degradedPage, degradedEvidence, { email: pr05ManagerEmail, password: smokePassword });
      await expect(degradedPage.getByTestId('realtime-connection-state')).toContainText('Realtime updates are delayed');
      const degradedSnapshotResponse = waitForApiResponse(degradedPage, 'GET', ganttPath);
      await degradedPage.goto(`/app/projects/${evidence.projectId}`);
      const degradedSnapshot = await recordOkJson(
        await degradedSnapshotResponse,
        degradedEvidence,
        'pr06-degraded-gantt-snapshot',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      await degradedPage.getByRole('tab', { name: 'Schedule', exact: true }).click();
      await expect(degradedPage.getByText(/HTTP edits and manual refresh remain authoritative/)).toBeVisible();
      const degradedSuccessor = pr06GanttItem(degradedSnapshot, pr06TaskTitles.successor);
      await pr06GanttItemLocator(degradedPage, degradedSuccessor.taskId)
        .getByRole('button', { name: 'Edit progress', exact: true }).click();
      await degradedPage.getByLabel('Progress percent').fill('15');
      const degradedProgressResponse = waitForApiResponse(
        degradedPage,
        'PATCH',
        `/api/tasks/${degradedSuccessor.taskId}/progress`
      );
      const degradedProgressRefetch = waitForSuccessfulApiResponse(degradedPage, 'GET', ganttPath);
      await degradedPage.getByRole('button', { name: 'Apply progress', exact: true }).click();
      const degradedProgress = await recordPr06Command(
        await degradedProgressResponse,
        evidence,
        'signalr-degraded-http-progress',
        200
      );
      expect(degradedProgress.request).toMatchObject({
        progressPercent: 15,
        expectedVersion: degradedSuccessor.version
      });
      const degradedAuthoritative = await recordOkJson(
        await degradedProgressRefetch,
        degradedEvidence,
        'pr06-degraded-progress-authoritative-refetch',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      expect(pr06GanttItem(degradedAuthoritative, pr06TaskTitles.successor).progressPercent).toBe(15);
      const degradedManualRefresh = waitForSuccessfulApiResponse(degradedPage, 'GET', ganttPath);
      await degradedPage.getByRole('button', { name: 'Refresh schedule', exact: true }).click();
      await recordOkJson(
        await degradedManualRefresh,
        degradedEvidence,
        'pr06-degraded-manual-http-refresh',
        isPr06GanttSnapshot
      );
      expect(degradedEvidence.pageErrors, 'SignalR-degraded browser page errors').toEqual([]);
      expectOnlyExpectedPr06HubConsoleErrors(degradedEvidence);
      expectUnexpectedApiFailures(degradedEvidence);
      evidence.degradedHttp = {
        connectionState: 'delayed',
        commandStatus: degradedProgress.response.status(),
        manualRefreshStatus: 200,
        apiInterception: 'none',
        pageErrors: [...degradedEvidence.pageErrors],
        consoleErrors: [...degradedEvidence.consoleErrors],
        failedApiResponses: [...degradedEvidence.failedApiResponses]
      };
      await degradedContext.close();
      degradedContext = null;

      const mainRefreshAfterDegraded = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.getByRole('button', { name: 'Refresh schedule', exact: true }).click();
      snapshot = await recordOkJson(
        await mainRefreshAfterDegraded,
        evidence,
        'pr06-main-refresh-after-degraded-command',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      expect(pr06GanttItem(snapshot, pr06TaskTitles.successor).progressPercent).toBe(15);

      // Keep the semantic edit dialog open while a separate real command
      // advances the same Task version. The UI then sends the stale version,
      // renders its optimistic dates, receives a real 409, rolls back, and
      // refetches the authoritative dates while preserving the user intent.
      const conflictBefore = pr06GanttItem(snapshot, pr06TaskTitles.conflict);
      const conflictLocator = pr06GanttItemLocator(page, conflictBefore.taskId);
      await conflictLocator.getByRole('button', { name: 'Edit dates', exact: true }).click();
      await page.getByLabel('Planned start').fill('2031-05-01');
      await page.getByLabel('Planned end').fill('2031-05-02');
      const concurrentConflict = await requestWithCsrf(
        page,
        'PATCH',
        `/api/tasks/${conflictBefore.taskId}/schedule`,
        {
          plannedStartDate: '2031-04-01',
          plannedEndDate: '2031-04-02',
          milestoneDate: null,
          expectedVersion: conflictBefore.version
        }
      );
      expect(concurrentConflict.status, concurrentConflict.text).toBe(200);
      expect(concurrentConflict.csrfHeaderPresent).toBe(true);
      const concurrentConflictBody = parseJson(concurrentConflict.text);
      expect(concurrentConflictBody.version).toBeGreaterThan(conflictBefore.version);
      evidence.commands.push({
        name: 'concurrent-real-schedule-update',
        method: 'PATCH',
        path: `/api/tasks/${conflictBefore.taskId}/schedule`,
        status: concurrentConflict.status,
        request: {
          plannedStartDate: '2031-04-01',
          plannedEndDate: '2031-04-02',
          milestoneDate: null,
          expectedVersion: conflictBefore.version
        },
        csrfHeaderPresent: concurrentConflict.csrfHeaderPresent
      });
      await expect(page.getByText(/authoritative refresh is queued until the active schedule interaction finishes/i))
        .toBeVisible({ timeout: 30_000 });

      await page.evaluate((taskId) => {
        const state = { transitions: [] as string[], observer: null as MutationObserver | null };
        const record = () => {
          const text = document.querySelector(`[data-gantt-item-id="${taskId}"]`)?.textContent ?? '';
          const dates = /(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(text);
          const value = dates ? `${dates[1]} to ${dates[2]}` : '';
          if (value && state.transitions.at(-1) !== value) state.transitions.push(value);
        };
        record();
        state.observer = new MutationObserver(record);
        state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        (window as Window & { __pr06ConflictObserver?: typeof state }).__pr06ConflictObserver = state;
      }, conflictBefore.taskId);
      const staleConflictResponse = waitForApiResponse(page, 'PATCH', `/api/tasks/${conflictBefore.taskId}/schedule`);
      const conflictRefetchResponse = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.getByRole('button', { name: 'Apply schedule', exact: true }).click();
      const staleConflict = await recordPr06Command(
        await staleConflictResponse,
        evidence,
        'stale-schedule-conflict',
        409
      );
      expect(staleConflict.request).toMatchObject({
        plannedStartDate: '2031-05-01',
        plannedEndDate: '2031-05-02',
        milestoneDate: null,
        expectedVersion: conflictBefore.version
      });
      expect(staleConflict.body.error?.code).toBe('GANTT_STALE_VERSION');
      expect(staleConflict.text).not.toMatch(/tenantId|workspaceId|PR06 dependency successor|browser-smoke-pr06-gantt/i);
      snapshot = await recordOkJson(
        await conflictRefetchResponse,
        evidence,
        'pr06-conflict-authoritative-refetch',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      const conflictAfter = pr06GanttItem(snapshot, pr06TaskTitles.conflict);
      expect(conflictAfter.plannedStartDate).toBe('2031-04-01');
      expect(conflictAfter.plannedEndDate).toBe('2031-04-02');
      await expect(page.getByRole('status')
        .filter({ hasText: /The edit intent is preserved against the authoritative schedule/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Retry preserved edit against the latest version/ })).toBeVisible();
      await expectLogicalPr06GanttFocus(pr06GanttItemLocator(page, conflictAfter.taskId));
      const optimisticDateTransitions = await page.evaluate(() => {
        const state = (window as Window & {
          __pr06ConflictObserver?: { transitions: string[]; observer: MutationObserver | null };
        }).__pr06ConflictObserver;
        state?.observer?.disconnect();
        return state?.transitions ?? [];
      });
      const optimisticIndex = optimisticDateTransitions.indexOf('2031-05-01 to 2031-05-02');
      expect(optimisticIndex, 'the stale command renders the optimistic dates before the backend responds').toBeGreaterThan(-1);
      expect(optimisticDateTransitions.slice(optimisticIndex + 1),
        'the real 409 rolls the schedule back to the authoritative concurrent dates')
        .toContain('2031-04-01 to 2031-04-02');
      evidence.staleConflict = {
        taskId: conflictBefore.taskId,
        staleVersion: conflictBefore.version,
        concurrentVersion: Number(concurrentConflictBody.version),
        code: staleConflict.body.error?.code,
        status: staleConflict.response.status(),
        authoritativeVersion: conflictAfter.version,
        authoritativeDates: {
          plannedStartDate: conflictAfter.plannedStartDate,
          plannedEndDate: conflictAfter.plannedEndDate
        },
        optimisticDateTransitions,
        intentPreserved: true,
        focusRestored: true
      };

      const reloadSnapshotResponse = waitForSuccessfulApiResponse(page, 'GET', ganttPath);
      await page.reload();
      snapshot = await recordOkJson(
        await reloadSnapshotResponse,
        evidence,
        'pr06-reload-persistence',
        isPr06GanttSnapshot
      ) as Pr06GanttSnapshotDto;
      await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
      expect(snapshot.unscheduledItems.some((item) => item.title === pr06TaskTitles.schedule)).toBe(true);
      expect(pr06GanttItem(snapshot, pr06TaskTitles.predecessor).progressPercent).toBe(35);
      expect(pr06GanttItem(snapshot, pr06TaskTitles.successor).progressPercent).toBe(15);
      expect(pr06GanttItem(snapshot, pr06MilestoneTitle).milestoneDate).toBe('2031-03-20');
      expect(pr06GanttItem(snapshot, pr06TaskTitles.conflict).plannedStartDate).toBe('2031-04-01');
      expect(snapshot.dependencies.some((dependency) => dependency.dependencyId === addedDependency!.dependencyId)).toBe(false);
      evidence.reloadPersistence = {
        scheduleTaskUnscheduled: true,
        progressPercent: 35,
        degradedProgressPercent: 15,
        milestoneDate: '2031-03-20',
        conflictDates: ['2031-04-01', '2031-04-02'],
        removedDependencyAbsent: true
      };

      const protectedDataClear = page.evaluate((protectedTitles) =>
        new Promise<'protected-data-cleared'>((resolve) => {
          const isClear = () => {
            const text = document.body.innerText;
            return document.querySelectorAll('[data-gantt-item-id]').length === 0 &&
              protectedTitles.every((title) => !text.includes(title));
          };
          if (isClear()) {
            resolve('protected-data-cleared');
            return;
          }
          const observer = new MutationObserver(() => {
            if (!isClear()) return;
            observer.disconnect();
            resolve('protected-data-cleared');
          });
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }), [...Object.values(pr06TaskTitles), pr06MilestoneTitle]);

      ownerContext = await browser.newContext({ baseURL: evidence.baseURL });
      const ownerPage = await ownerContext.newPage();
      const ownerEvidence: SmokeEvidence = {
        baseURL: evidence.baseURL,
        email: smokeEmail,
        steps: [],
        pageErrors: [],
        consoleErrors: [],
        failedApiResponses: []
      };
      ownerPage.on('pageerror', (error) => ownerEvidence.pageErrors.push(error.message));
      ownerPage.on('console', (message) => {
        if (message.type() === 'error') ownerEvidence.consoleErrors.push(message.text());
      });
      ownerPage.on('response', (response) => recordFailedApiResponse(response, ownerEvidence));
      await loginAndVerifySession(ownerPage, ownerEvidence);
      expect(ownerEvidence.userId, 'the revoking Owner is a distinct authenticated user').not.toBe(evidence.userId);
      expect(ownerEvidence.userId).toBe(String(ownerMember.userId));

      const responseGateId = randomUUID().replaceAll('-', '');
      const gateArm = await requestWithCsrf(
        page,
        'POST',
        `${pr05ResponseGatePath}/${responseGateId}/arm`,
        { method: 'GET', path: ganttPath }
      );
      expect(gateArm.status, gateArm.text).toBe(200);
      expect(gateArm.csrfHeaderPresent).toBe(true);
      await page.context().addCookies([{
        name: pr05ResponseGateCookieName,
        value: responseGateId,
        url: new URL('/', page.url()).href
      }]);

      const heldAuthorizedRefreshResponse = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === ganttPath &&
        response.status() === 200 &&
        response.headers()[pr05ResponseGateHeaderName] === responseGateId
      );
      const heldRefreshRequest = page.waitForRequest((request) =>
        request.method() === 'GET' && new URL(request.url()).pathname === ganttPath);
      await page.getByRole('button', { name: 'Refresh schedule', exact: true }).click();
      await heldRefreshRequest;
      await expect.poll(async () => {
        const gate = await fetchJsonFromPage(page, `${pr05ResponseGatePath}/${responseGateId}`);
        return gate.status === 200 ? gate.body : { state: `HTTP ${gate.status}`, statusCode: null };
      }, {
        message: 'the real authorized Gantt response reaches the one-shot response gate',
        timeout: 10_000
      }).toMatchObject({ state: 'waiting', statusCode: 200 });

      const deniedRefreshResponse = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === ganttPath &&
        response.status() === 404
      );
      const projectDetailPath = `/api/projects/${evidence.projectId}`;
      const deniedProjectDetailResponse = page.waitForResponse((response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === projectDetailPath
      );
      const firstRevocationObservationPromise = Promise.race([
        protectedDataClear,
        deniedRefreshResponse.then(() => 'denial-response' as const)
      ]);
      const revoke = await requestWithCsrf(
        ownerPage,
        'DELETE',
        `/api/projects/${evidence.projectId}/members/${evidence.userId}`
      );
      expect(revoke.status, revoke.text).toBe(200);
      expect(revoke.csrfHeaderPresent).toBe(true);
      const firstRevocationObservation = await firstRevocationObservationPromise;
      expect(firstRevocationObservation,
        'protected schedule DOM is cleared before the authoritative denial response is delivered')
        .toBe('protected-data-cleared');
      const deniedResponse = await deniedRefreshResponse;
      const deniedText = await deniedResponse.text();
      evidence.steps.push({
        name: 'pr06-authorization-state-safe-gantt-denial',
        method: 'GET',
        path: new URL(deniedResponse.url()).pathname,
        status: deniedResponse.status(),
        bodyPreview: preview(deniedText)
      });
      expectCanonicalGanttDenial(deniedText, 'GANTT_PROJECT_NOT_FOUND');
      const deniedProjectResponse = await deniedProjectDetailResponse;
      const deniedProjectText = await deniedProjectResponse.text();
      const expectedProjectDetailDenial: SmokeFailedApiResponse = {
        method: deniedProjectResponse.request().method(),
        path: new URL(deniedProjectResponse.url()).pathname,
        status: deniedProjectResponse.status()
      };
      evidence.steps.push({
        name: 'pr06-project-detail-safe-denial-after-revocation',
        method: expectedProjectDetailDenial.method,
        path: expectedProjectDetailDenial.path,
        status: expectedProjectDetailDenial.status,
        bodyPreview: preview(deniedProjectText)
      });
      const deniedProjectBody = expectSafeProjectDetailDenial(deniedProjectText, [
        evidence.projectId!, evidence.workspaceId!, pr06ProjectTitle,
        ...Object.values(pr06TaskTitles), pr06MilestoneTitle
      ]);
      expect(deniedProjectResponse.status(), 'revoked Project detail uses the established safe denial contract')
        .toBe(400);
      expect(evidence.failedApiResponses).toContainEqual(expectedProjectDetailDenial);
      await expect(page.locator('[data-gantt-item-id]')).toHaveCount(0);
      await expect(page.locator('[data-gantt-dependency-id]')).toHaveCount(0);
      for (const title of [...Object.values(pr06TaskTitles), pr06MilestoneTitle]) {
        await expect(page.getByText(title, { exact: true })).toHaveCount(0);
      }
      await expect(page.locator('body')).not.toContainText(/DEPENDENCY_VIOLATION|LEGACY_DEPENDENCY_TYPE|PARENT_DERIVED/);

      await page.evaluate((protectedTitles) => {
        const state = { restored: false, observer: null as MutationObserver | null };
        const observe = () => {
          const text = document.body.innerText;
          if (
            document.querySelectorAll('[data-gantt-item-id]').length > 0 ||
            protectedTitles.some((title) => text.includes(title))
          ) {
            state.restored = true;
          }
        };
        state.observer = new MutationObserver(observe);
        state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        (window as Window & { __pr06RevocationObserver?: typeof state }).__pr06RevocationObserver = state;
        observe();
      }, [...Object.values(pr06TaskTitles), pr06MilestoneTitle]);

      const gateRelease = await requestWithCsrf(
        page,
        'POST',
        `${pr05ResponseGatePath}/${responseGateId}/release`
      );
      expect(gateRelease.status, gateRelease.text).toBe(200);
      const staleAuthorizedResponse = await heldAuthorizedRefreshResponse;
      expect(staleAuthorizedResponse.status()).toBe(200);
      expect(await staleAuthorizedResponse.finished()).toBeNull();
      evidence.steps.push({
        name: 'pr06-stale-authorized-gantt-response-after-revocation',
        method: 'GET',
        path: new URL(staleAuthorizedResponse.url()).pathname,
        status: staleAuthorizedResponse.status()
      });
      await page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const protectedDataRestoredByStaleResponse = await page.evaluate(() => {
        const state = (window as Window & {
          __pr06RevocationObserver?: { restored: boolean; observer: MutationObserver | null };
        }).__pr06RevocationObserver;
        state?.observer?.disconnect();
        return state?.restored ?? true;
      });
      expect(protectedDataRestoredByStaleResponse,
        'the held authorized Gantt 200 must not restore protected schedule data').toBe(false);
      await expect(page.locator('[data-gantt-item-id]')).toHaveCount(0);

      const subsequentDenial = await fetchFromPage(page, ganttPath);
      evidence.steps.push({
        name: 'pr06-subsequent-gantt-safe-denial',
        method: 'GET',
        path: ganttPath,
        status: subsequentDenial.status,
        bodyPreview: preview(subsequentDenial.text)
      });
      expect(subsequentDenial.status).toBe(404);
      expectCanonicalGanttDenial(subsequentDenial.text, 'GANTT_PROJECT_NOT_FOUND');
      expect(ownerEvidence.pageErrors, 'revoking Owner browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(ownerEvidence);
      expectUnexpectedApiFailures(ownerEvidence);
      evidence.authorizationRevocation = {
        revokingActorUserId: ownerEvidence.userId!,
        revokedUserId: evidence.userId!,
        revokeStatus: revoke.status,
        overlappingRefreshStatus: staleAuthorizedResponse.status(),
        projectDetailDenialStatus: deniedProjectResponse.status(),
        projectDetailDenialCode: String(deniedProjectBody.code),
        denialStatus: deniedResponse.status(),
        subsequentDenialStatus: subsequentDenial.status,
        protectedDataClearedBeforeRevalidation: firstRevocationObservation === 'protected-data-cleared',
        protectedDataRestoredByStaleResponse,
        revokingPageErrors: [...ownerEvidence.pageErrors],
        revokingConsoleErrors: [...ownerEvidence.consoleErrors],
        revokingFailedApiResponses: [...ownerEvidence.failedApiResponses]
      };

      expect(evidence.pageErrors, 'browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(evidence, [expectedProjectDetailDenial]);
      expectUnexpectedApiFailures(evidence, [expectedProjectDetailDenial]);
    } finally {
      await degradedContext?.close();
      await ownerContext?.close();
      await viewerContext?.close();
      await testInfo.attach('task-v1-pr06-real-backend-evidence.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json'
      });
    }
  });

  test('TASK-V1-PR07-D reauthorizes notification delivery, opens current Task routes, and clears revoked state through the real backend', async ({ page, browser }, testInfo) => {
    const evidence: SmokeEvidence = {
      baseURL: String(testInfo.project.use.baseURL ?? ''),
      email: pr06ViewerEmail,
      steps: [],
      pageErrors: [],
      consoleErrors: [],
      failedApiResponses: []
    };
    let ownerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
    page.on('response', (response) => recordFailedApiResponse(response, evidence));

    try {
      await loginAndVerifySession(
        page,
        evidence,
        { email: pr06ViewerEmail, password: `${smokePassword}:recipient` }
      );
      await expect(page.getByTestId('realtime-connection-state')).toContainText('Realtime updates connected.', { timeout: 30_000 });

      const projects = await recordFetchJson(page, evidence, 'pr07-project-fixture', '/api/projects?page=1&pageSize=100', {
        validate: (body) => isPagedResponse(body) &&
          body.items.some((item: unknown) => hasStringValue(item, 'title', pr07ProjectTitle))
      }) as Record<string, any>;
      const project = projects.items.find((item: Record<string, unknown>) => item.title === pr07ProjectTitle)!;
      const projectId = String(project.id);
      const workspaceId = String(project.workspaceId);
      const recipientUserId = evidence.userId!;
      expect(projectId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/i);

      if (await page.getByTestId('right-panel-open').count()) {
        await page.getByTestId('right-panel-open').click();
      }
      await expect(page.getByRole('heading', { name: 'Notifications and members' })).toBeVisible();

      // The immediate delivery below happens only after the existing client
      // reconnects and re-subscribes to its current authorized User route.
      await verifyRealtimeTransportReconnect(page, evidence);

      ownerContext = await browser.newContext({ baseURL: evidence.baseURL });
      const ownerPage = await ownerContext.newPage();
      const ownerEvidence: SmokeEvidence = {
        baseURL: evidence.baseURL,
        email: smokeEmail,
        steps: [],
        pageErrors: [],
        consoleErrors: [],
        failedApiResponses: []
      };
      ownerPage.on('pageerror', (error) => ownerEvidence.pageErrors.push(error.message));
      ownerPage.on('console', (message) => { if (message.type() === 'error') ownerEvidence.consoleErrors.push(message.text()); });
      ownerPage.on('response', (response) => recordFailedApiResponse(response, ownerEvidence));
      await loginAndVerifySession(ownerPage, ownerEvidence);

      const stageNotification = async (dispatchDelaySeconds: number) => {
        const response = await requestWithCsrf(
          ownerPage,
          'POST',
          `${pr07NotificationFixturePath}/task`,
          { dispatchDelaySeconds }
        );
        evidence.steps.push({
          name: dispatchDelaySeconds === 0 ? 'pr07-stage-immediate-task-notification' : 'pr07-stage-delayed-task-notification',
          method: 'POST',
          path: `${pr07NotificationFixturePath}/task`,
          status: response.status
        });
        expect(response.status, response.text).toBe(200);
        expect(response.csrfHeaderPresent).toBe(true);
        const body = parseJson(response.text) as Record<string, unknown>;
        const notificationId = String(body.notificationId ?? '');
        const eventId = String(body.eventId ?? '');
        const fixtureProjectId = String(body.projectId ?? '');
        const taskId = String(body.taskId ?? '');
        expect(notificationId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(eventId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(fixtureProjectId).toBe(projectId);
        expect(taskId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(Number(body.dispatchDelaySeconds)).toBe(dispatchDelaySeconds);
        return { notificationId, eventId, taskId };
      };

      const immediate = await stageNotification(0);
      const immediateItem = page.locator('app-notification-item', { hasText: pr07NotificationTitle }).first();
      await expect(immediateItem).toBeVisible({ timeout: 30_000 });
      await expect(immediateItem.getByTestId('notification-target-link')).toBeVisible();

      const openResponse = waitForApiResponse(page, 'POST', `/api/notifications/${immediate.notificationId}/open`);
      const expectedTaskUrl = new RegExp(`/app/projects/${projectId}/tasks/${immediate.taskId}$`);
      const taskNavigation = page.waitForURL(expectedTaskUrl);
      await immediateItem.getByTestId('notification-target-link').click();
      const opened = await openResponse;
      const openedText = await opened.text();
      const openedBody = parseJson(openedText) as Record<string, unknown>;
      evidence.steps.push({
        name: 'pr07-open-authorized-task-notification',
        method: 'POST',
        path: `/api/notifications/${immediate.notificationId}/open`,
        status: opened.status(),
        bodyPreview: preview(openedText)
      });
      expect(opened.status(), openedText).toBe(200);
      expect(openedBody.status).toBe('Opened');
      expect(openedBody.route).toBe(`/projects/${projectId}/tasks/${immediate.taskId}`);
      await taskNavigation;
      await expect(page.getByRole('heading', { name: pr07TaskTitle })).toBeVisible();

      // Keep a visible protected notification in the real RightPanel while
      // access changes; the next notification is deliberately held in the
      // existing outbox until after the membership revocation commits.
      await page.goto('/app/workspaces');
      if (await page.getByTestId('right-panel-open').count()) {
        await page.getByTestId('right-panel-open').click();
      }
      await expect(page.locator('app-notification-item', { hasText: pr07NotificationTitle })).toHaveCount(1);
      const delayed = await stageNotification(8);

      const protectedNotificationCleared = expect(
        page.locator('app-notification-item', { hasText: pr07NotificationTitle })
      ).toHaveCount(0, { timeout: 30_000 });
      const revoke = await requestWithCsrf(
        ownerPage,
        'DELETE',
        `/api/projects/${projectId}/members/${recipientUserId}`
      );
      evidence.steps.push({
        name: 'pr07-project-membership-revoked-before-delayed-delivery',
        method: 'DELETE',
        path: `/api/projects/${projectId}/members/${recipientUserId}`,
        status: revoke.status
      });
      expect(revoke.status, revoke.text).toBe(200);
      expect(revoke.csrfHeaderPresent).toBe(true);
      await protectedNotificationCleared;

      const unavailable = await requestWithCsrf(
        page,
        'POST',
        `/api/notifications/${delayed.notificationId}/open`
      );
      const unavailableBody = parseJson(unavailable.text) as Record<string, unknown>;
      evidence.steps.push({
        name: 'pr07-open-revoked-task-notification-is-unavailable',
        method: 'POST',
        path: `/api/notifications/${delayed.notificationId}/open`,
        status: unavailable.status,
        bodyPreview: preview(unavailable.text)
      });
      expect(unavailable.status, unavailable.text).toBe(200);
      expect(unavailableBody).toMatchObject({ status: 'Unavailable', route: null });
      expect(unavailable.text).not.toContain(pr07TaskTitle);
      expect(unavailable.text).not.toContain(projectId);

      const hidden = await fetchJsonFromPage(page, '/api/notifications?page=1&pageSize=100');
      evidence.steps.push({
        name: 'pr07-revoked-task-notifications-are-hidden-from-list',
        method: 'GET',
        path: '/api/notifications',
        status: hidden.status,
        bodyPreview: preview(JSON.stringify(hidden.body))
      });
      expect(hidden.status).toBe(200);
      expect(Array.isArray(hidden.body?.items)).toBe(true);
      expect(hidden.body.items.some((item: Record<string, unknown>) =>
        item.id === immediate.notificationId || item.id === delayed.notificationId)).toBe(false);

      await expect.poll(async () => {
        const status = await fetchJsonFromPage(ownerPage, `${pr07NotificationFixturePath}/events/${delayed.eventId}`);
        return status.status === 200 ? status.body : { status: `HTTP ${status.status}` };
      }, {
        message: 'the delayed task notification is terminally suppressed after current authorization is revoked',
        timeout: 35_000
      }).toMatchObject({
        eventId: delayed.eventId,
        status: 'Delivered',
        attemptCount: 0,
        outcomeCode: 'NoAuthorizedRecipient'
      });
      await expect(page.locator('app-notification-item', { hasText: pr07NotificationTitle })).toHaveCount(0);

      expect(ownerEvidence.pageErrors, 'PR07-D owner browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(ownerEvidence);
      expectUnexpectedApiFailures(ownerEvidence);
      expect(evidence.pageErrors, 'PR07-D recipient browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(evidence);
      expectUnexpectedApiFailures(evidence);
    } finally {
      await ownerContext?.close();
      await testInfo.attach('task-v1-pr07d-real-backend-evidence.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json'
      });
    }
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
      const grantBody = parseJson(grant.text) as Record<string, unknown>;
      const grantId = String(grantBody.fileDownloadGrantId ?? '');
      const grantToken = String(grantBody.token ?? '');
      expect(grantId, 'download grant id').toMatch(/^[0-9a-f-]{36}$/i);
      expect(grantToken, 'download grant token').not.toBe('');
      const browserStorage = await page.evaluate(() => JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage }
      }));
      expect(browserStorage, 'download grant token must remain ephemeral').not.toContain(grantToken);

      const directOpen = await fetchBinaryFromPage(page, `/api/attachments/${attachmentId}/download`);
      evidence.steps.push({ name: 'pr03c-file-open-before-revocation', method: 'GET', path: `/api/attachments/${attachmentId}/download`, status: directOpen.status });
      expect(directOpen.status, 'authorized actor can open the physical synthetic Attachment').toBe(200);
      expect(directOpen.text, 'authorized direct open returns the seeded bytes').toBe('Synthetic PR03C browser smoke file.\n');

      const grantedDownload = await requestBinaryWithCsrf(page, `/api/attachment-download-grants/${grantId}/download`, { token: grantToken });
      evidence.steps.push({ name: 'pr03c-file-grant-download-before-revocation', method: 'POST', path: `/api/attachment-download-grants/${grantId}/download`, status: grantedDownload.status });
      expect(grantedDownload.status, 'fresh grant downloads the physical synthetic Attachment').toBe(200);
      expect(grantedDownload.text, 'authorized grant returns the seeded bytes').toBe('Synthetic PR03C browser smoke file.\n');

      const retainedGrant = await requestWithCsrf(page, 'POST', `/api/attachments/${attachmentId}/download-grants`, { purpose: 'pr03c-revocation-probe' });
      expect(retainedGrant.status, 'revocation probe receives a fresh one-time grant').toBe(200);
      const retainedGrantBody = parseJson(retainedGrant.text) as Record<string, unknown>;
      const retainedGrantId = String(retainedGrantBody.fileDownloadGrantId ?? '');
      const retainedGrantToken = String(retainedGrantBody.token ?? '');
      expect(retainedGrantId, 'retained download grant id').toMatch(/^[0-9a-f-]{36}$/i);
      expect(retainedGrantToken, 'retained download grant token').not.toBe('');

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

      const revokedProjects = await fetchJsonFromPage(page, '/api/projects?page=1&pageSize=100');
      evidence.steps.push({
        name: 'pr03c-project-list-cleared-after-workspace-revocation',
        method: 'GET',
        path: '/api/projects',
        status: revokedProjects.status
      });
      expect(revokedProjects.status, 'Project list remains safely queryable after Workspace revocation').toBe(200);
      expect(isPagedResponse(revokedProjects.body), 'revoked Project list keeps the canonical page shape').toBe(true);
      expect(
        revokedProjects.body.items.some((item: Record<string, unknown>) => item.workspaceId === workspaceId),
        'ProjectMember rows must not outlive active access to their Workspace'
      ).toBe(false);
      expect(
        revokedProjects.body.items.some((item: Record<string, unknown>) => item.id === projectId),
        'the revoked Project must not remain visible'
      ).toBe(false);
      expect(JSON.stringify(revokedProjects.body), 'revoked Project list must not disclose protected Project metadata')
        .not.toMatch(/Browser Smoke Project|PR05 Browser Acceptance Project/i);

      const deniedTask = await fetchFromPage(page, `/api/tasks/${taskId}`);
      evidence.steps.push({ name: 'pr03c-task-denied-after-revocation', method: 'GET', path: `/api/tasks/${taskId}`, status: deniedTask.status, bodyPreview: preview(deniedTask.text) });
      expect(deniedTask.status, 'revoked actor must receive the canonical task safe-not-found response').toBe(404);
      expectCanonicalDenial(deniedTask.text, 'TASK_NOT_FOUND');

      const revokedMyTasks = await fetchJsonFromPage(page, '/api/me/tasks?view=assigned&scope=allWorkspaces');
      evidence.steps.push({ name: 'pr03c-my-tasks-cleared-after-revocation', method: 'GET', path: '/api/me/tasks', status: revokedMyTasks.status });
      expect(revokedMyTasks.status, 'My Tasks remains safely queryable after membership revocation').toBe(200);
      expect(revokedMyTasks.body?.items, 'revoked Workspace rows must disappear from My Tasks').toEqual([]);
      expect(revokedMyTasks.body?.totalCount, 'revoked Workspace rows must not contribute to My Tasks total').toBe(0);
      expect(revokedMyTasks.body?.availableWorkspaceCount, 'revoked Workspace must not remain available').toBe(0);

      const revokedMyTaskCounts = await fetchJsonFromPage(page, '/api/me/tasks/counts?scope=allWorkspaces');
      evidence.steps.push({ name: 'pr03c-my-task-counts-cleared-after-revocation', method: 'GET', path: '/api/me/tasks/counts', status: revokedMyTaskCounts.status });
      expect(revokedMyTaskCounts.status, 'My Tasks counts remain safely queryable after membership revocation').toBe(200);
      expect(revokedMyTaskCounts.body?.availableWorkspaceCount, 'revoked Workspace must not remain in count scope').toBe(0);
      expect(
        (revokedMyTaskCounts.body?.views ?? []).every((view: Record<string, unknown>) => view.count === 0),
        'revoked Workspace rows must not contribute to any relationship count'
      ).toBe(true);

      const deniedGrant = await requestWithCsrf(page, 'POST', `/api/attachments/${attachmentId}/download-grants`, { purpose: 'pr03c-after-revocation' });
      evidence.steps.push({ name: 'pr03c-file-grant-denied-after-revocation', method: 'POST', path: `/api/attachments/${attachmentId}/download-grants`, status: deniedGrant.status, bodyPreview: preview(deniedGrant.text) });
      expect(deniedGrant.status, 'revoked actor must receive the canonical grant safe-not-found response').toBe(404);
      expectCanonicalDenial(deniedGrant.text, 'FILE_DOWNLOAD_GRANT_NOT_FOUND');
      expect(deniedGrant.text, 'denial must not disclose the protected File metadata').not.toMatch(/browser-smoke-task|storageKey|filePath|tokenHash|internal\/task-file/i);

      const deniedOpen = await fetchBinaryFromPage(page, `/api/attachments/${attachmentId}/download`);
      evidence.steps.push({ name: 'pr03c-file-open-denied-after-revocation', method: 'GET', path: `/api/attachments/${attachmentId}/download`, status: deniedOpen.status });
      expect(deniedOpen.status, 'revoked actor cannot open the physical Attachment').toBe(400);
      expect(deniedOpen.text, 'revoked direct open must not return the seeded bytes').not.toContain('Synthetic PR03C browser smoke file.');

      const deniedRetainedGrant = await requestBinaryWithCsrf(page, `/api/attachment-download-grants/${retainedGrantId}/download`, { token: retainedGrantToken });
      evidence.steps.push({ name: 'pr03c-retained-grant-denied-after-revocation', method: 'POST', path: `/api/attachment-download-grants/${retainedGrantId}/download`, status: deniedRetainedGrant.status });
      expect(deniedRetainedGrant.status, 'membership revocation invalidates a previously issued unused grant').toBe(400);
      expect(deniedRetainedGrant.text, 'revoked retained grant must not return the seeded bytes').not.toContain('Synthetic PR03C browser smoke file.');

      expect(evidence.pageErrors, 'browser page errors').toEqual([]);
      expectUnexpectedConsoleErrors(evidence);
      expectUnexpectedApiFailures(evidence);
    } finally {
      await testInfo.attach('task-v1-pr03c-real-backend-evidence.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    }
  });
});

async function loginAndVerifySession(
  page: Page,
  evidence: SmokeEvidence,
  credentials: { email: string; password: string } = { email: smokeEmail, password: smokePassword }
) {
  await page.goto('/app/login');
  await expect(page.getByTestId('login-page')).toBeVisible();
  await recordFetchJson(page, evidence, 'csrf-token', '/api/security/csrf-token', {
    sensitive: true,
    validate: (body) => hasString(body, 'token') && hasString(body, 'headerName')
  });

  await page.getByTestId('login-email').fill(credentials.email);
  await page.getByTestId('login-password').fill(credentials.password);

  const [loginResponse] = await Promise.all([
    waitForApiResponse(page, 'POST', '/api/auth/login'),
    page.getByTestId('login-submit').click()
  ]);

  const loginBody = await recordOkJson(loginResponse, evidence, 'login', (body) =>
    hasString(body, 'userId') &&
    hasStringValue(body, 'email', credentials.email) &&
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
      hasStringValue(body, 'email', credentials.email) &&
      Array.isArray((body as Record<string, unknown>).workspaces) &&
      hasCapability(body, 'projects:view')
  });
}

async function recordPr06Command(
  response: PlaywrightResponse,
  evidence: Pr06GanttEvidence,
  name: string,
  expectedStatus: 200 | 409
): Promise<{
  response: PlaywrightResponse;
  request: Record<string, any>;
  body: any;
  text: string;
}> {
  const text = await response.text();
  const body = parseJson(text);
  const request = response.request().postData()
    ? response.request().postDataJSON() as Record<string, any>
    : {};
  const headers = await response.request().allHeaders();
  const csrfHeaderPresent = Object.entries(headers)
    .some(([headerName, value]) => headerName.toLowerCase() === 'x-csrf-token' && value.length > 0);
  const method = response.request().method();
  const path = new URL(response.url()).pathname;

  evidence.steps.push({
    name: `pr06-${name}`,
    method,
    path,
    status: response.status(),
    bodyPreview: preview(text)
  });
  expect(response.status(), `${name} response ${response.status()}: ${text}`).toBe(expectedStatus);
  expect(csrfHeaderPresent, `${name} uses the real Angular/browser CSRF token`).toBe(true);
  if (expectedStatus === 200) {
    const valid =
      (method === 'PATCH' &&
        typeof body?.taskId === 'string' &&
        typeof body?.version === 'number' &&
        Array.isArray(body?.warnings)) ||
      (method === 'POST' &&
        typeof body?.id === 'string' &&
        typeof body?.predecessorTaskId === 'string' &&
        typeof body?.successorTaskId === 'string' &&
        body?.dependencyType === 'FinishToStart') ||
      (method === 'DELETE' && body?.status === 'OK');
    expect(valid, `${name} canonical command response: ${text}`).toBe(true);
  } else {
    expect(
      body && typeof body === 'object' &&
      typeof body.requestId === 'string' &&
      body.error && typeof body.error === 'object' &&
      typeof body.error.code === 'string' &&
      Array.isArray(body.error.details),
      `${name} safe conflict response: ${text}`
    ).toBe(true);
  }

  evidence.commands.push({
    name,
    method,
    path,
    status: response.status(),
    request,
    csrfHeaderPresent
  });
  return { response, request, body, text };
}

function isPr06GanttSnapshot(body: unknown): body is Pr06GanttSnapshotDto {
  if (!body || typeof body !== 'object') return false;
  const snapshot = body as Record<string, any>;
  const collections = [
    snapshot.scheduledItems,
    snapshot.unscheduledItems,
    snapshot.milestones,
    snapshot.dependencies,
    snapshot.warnings
  ];
  if (
    typeof snapshot.projectId !== 'string' ||
    typeof snapshot.projectTitle !== 'string' ||
    typeof snapshot.projectVersion !== 'number' ||
    typeof snapshot.workflowVersion !== 'number' ||
    !snapshot.calendar ||
    typeof snapshot.calendar.timeZone !== 'string' ||
    !Array.isArray(snapshot.calendar.workingDays) ||
    typeof snapshot.calendar.holidaysAvailable !== 'boolean' ||
    !Array.isArray(snapshot.calendar.limitations) ||
    collections.some((collection) => !Array.isArray(collection)) ||
    !snapshot.permissions ||
    typeof snapshot.permissions.canEditSchedule !== 'boolean' ||
    typeof snapshot.permissions.canEditProgress !== 'boolean' ||
    typeof snapshot.permissions.canManageDependencies !== 'boolean' ||
    typeof snapshot.permissions.canClearSchedule !== 'boolean' ||
    typeof snapshot.permissions.canOpen !== 'boolean' ||
    typeof snapshot.maximumItems !== 'number' ||
    typeof snapshot.totalItems !== 'number'
  ) {
    return false;
  }

  const itemIsCanonical = (item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const value = item as Record<string, any>;
    return typeof value.taskId === 'string' &&
      (value.kind === 'Task' || value.kind === 'Milestone') &&
      typeof value.title === 'string' &&
      typeof value.progressPercent === 'number' &&
      typeof value.progressIsDerived === 'boolean' &&
      typeof value.version === 'number' &&
      value.scheduleEditPermissions &&
      typeof value.scheduleEditPermissions.canEditSchedule === 'boolean' &&
      typeof value.scheduleEditPermissions.canEditProgress === 'boolean' &&
      typeof value.scheduleEditPermissions.canManageDependencies === 'boolean' &&
      typeof value.scheduleEditPermissions.canClearSchedule === 'boolean' &&
      typeof value.scheduleEditPermissions.canOpen === 'boolean' &&
      Array.isArray(value.warnings);
  };
  const dependencyIsCanonical = (dependency: unknown) => {
    if (!dependency || typeof dependency !== 'object') return false;
    const value = dependency as Record<string, any>;
    return typeof value.dependencyId === 'string' &&
      typeof value.predecessorTaskId === 'string' &&
      typeof value.successorTaskId === 'string' &&
      typeof value.type === 'string' &&
      typeof value.editable === 'boolean' &&
      typeof value.version === 'number' &&
      Array.isArray(value.warnings);
  };
  return snapshot.scheduledItems.every(itemIsCanonical) &&
    snapshot.unscheduledItems.every(itemIsCanonical) &&
    snapshot.milestones.every(itemIsCanonical) &&
    snapshot.dependencies.every(dependencyIsCanonical);
}

function pr06GanttItem(snapshot: Pr06GanttSnapshotDto, title: string): Pr06GanttItemDto {
  const item = [...snapshot.scheduledItems, ...snapshot.unscheduledItems, ...snapshot.milestones]
    .find((candidate) => candidate.title === title);
  expect(item, `${title} is present in the real canonical Gantt response`).toBeTruthy();
  return item!;
}

function pr06GanttItemLocator(page: Page, taskId: string): Locator {
  return page.locator(`[data-gantt-item-id="${taskId}"]`);
}

async function expectLogicalPr06GanttFocus(item: Locator): Promise<void> {
  await expect.poll(() => item.evaluate((element) =>
    element === document.activeElement || element.contains(document.activeElement)
  )).toBe(true);
}

function taskDetailVersion(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const task = (body as Record<string, any>).task;
  return task && typeof task.version === 'number' ? task.version : null;
}

function taskDeadlineAt(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const task = (body as Record<string, any>).task;
  return task && typeof task.deadlineAt === 'string' ? task.deadlineAt : null;
}

function expectCanonicalGanttDenial(text: string, expectedCode: string): void {
  const body = parseJson(text) as Record<string, any>;
  expect(typeof body.requestId, 'safe Gantt denial requestId').toBe('string');
  expect(body.error?.code, 'safe Gantt denial code').toBe(expectedCode);
  expect(body.error?.redactionApplied, 'safe Gantt denial redaction marker').toBe(true);
  expect(Array.isArray(body.error?.details), 'safe Gantt denial details').toBe(true);
  expect(text, 'safe Gantt denial must not expose protected schedule metadata').not.toMatch(
    /tenantId|workspaceId|PR06 (?:derived|schedule|predecessor|unscheduled|conflict|dependency|release)|browser-smoke-pr06-gantt|DeadlineAt|SQL/i
  );
}

async function recordPr05KanbanCommand(
  response: PlaywrightResponse,
  evidence: Pr05KanbanEvidence,
  name: string,
  expectedStatus: 200 | 409
): Promise<{
  response: PlaywrightResponse;
  request: Record<string, any>;
  body: any;
}> {
  const text = await response.text();
  const body = parseJson(text);
  const request = response.request().postDataJSON() as Record<string, any>;
  const headers = await response.request().allHeaders();
  const csrfHeaderPresent = Object.entries(headers)
    .some(([headerName, value]) => headerName.toLowerCase() === 'x-csrf-token' && value.length > 0);

  evidence.steps.push({
    name: `pr05-${name}`,
    method: response.request().method(),
    path: new URL(response.url()).pathname,
    status: response.status(),
    bodyPreview: preview(text)
  });
  expect(response.status(), `${name} response ${response.status()}: ${text}`).toBe(expectedStatus);
  expect(csrfHeaderPresent, `${name} uses the Angular CSRF interceptor`).toBe(true);
  if (expectedStatus === 200) {
    expect(isPr05KanbanCommandResponse(body), `${name} authoritative command response: ${text}`).toBe(true);
  } else {
    expect(
      body && typeof body === 'object' &&
      typeof body.requestId === 'string' &&
      body.error && typeof body.error === 'object' &&
      typeof body.error.code === 'string',
      `${name} safe conflict response: ${text}`
    ).toBe(true);
  }

  const authoritativeBoardVersion =
    expectedStatus === 200 && isPr05KanbanCommandResponse(body)
      ? body.snapshot.board.version
      : undefined;
  evidence.commands.push({
    name,
    responseUrl: response.url(),
    status: response.status(),
    taskId: new URL(response.url()).pathname.split('/')[3] ?? '',
    expectedTaskVersion: Number(request.expectedTaskVersion),
    expectedBoardVersion: Number(request.expectedBoardVersion),
    authoritativeBoardVersion,
    targetWorkflowStageId: String(request.targetWorkflowStageId),
    targetBeforeTaskId: request.targetBeforeTaskId === null ? null : String(request.targetBeforeTaskId),
    targetAfterTaskId: request.targetAfterTaskId === null ? null : String(request.targetAfterTaskId),
    reason: typeof request.reason === 'string' ? request.reason : null,
    csrfHeaderPresent
  });
  return { response, request, body };
}

function isPr05KanbanCommandResponse(body: unknown): body is Pr05KanbanCommandResponseDto {
  if (!body || typeof body !== 'object') return false;
  const response = body as Record<string, unknown>;
  return isPr05KanbanSnapshot(response.snapshot) &&
    (response.focusTaskId === null || typeof response.focusTaskId === 'string') &&
    Array.isArray(response.warnings);
}

function isPr05KanbanSnapshot(body: unknown): body is Pr05KanbanSnapshotDto {
  if (!body || typeof body !== 'object') return false;
  const snapshot = body as Record<string, any>;
  if (
    !snapshot.board ||
    typeof snapshot.board !== 'object' ||
    typeof snapshot.board.projectId !== 'string' ||
    typeof snapshot.board.version !== 'number' ||
    typeof snapshot.board.totalAuthorizedCardCount !== 'number' ||
    typeof snapshot.board.isTruncated !== 'boolean' ||
    typeof snapshot.board.uiPermissions?.canConfigure !== 'boolean' ||
    !Array.isArray(snapshot.board.warnings) ||
    !Array.isArray(snapshot.columns) ||
    !Array.isArray(snapshot.cards)
  ) {
    return false;
  }

  return snapshot.columns.every((column: unknown) => {
    if (!column || typeof column !== 'object') return false;
    const value = column as Record<string, any>;
    return typeof value.workflowStageId === 'string' &&
      typeof value.displayName === 'string' &&
      typeof value.category !== 'undefined' &&
      typeof value.displayOrder === 'number' &&
      typeof value.currentAuthorizedCardCount === 'number' &&
      typeof value.hasWipWarning === 'boolean' &&
      typeof value.uiPermissions?.canConfigure === 'boolean';
  }) && snapshot.cards.every((card: unknown) => {
    if (!card || typeof card !== 'object') return false;
    const value = card as Record<string, any>;
    return typeof value.taskId === 'string' &&
      typeof value.summary === 'string' &&
      typeof value.workflowStageId === 'string' &&
      typeof value.boardOrder === 'number' &&
      typeof value.version === 'number' &&
      typeof value.uiPermissions?.canOpen === 'boolean' &&
      typeof value.uiPermissions?.canMove === 'boolean' &&
      Array.isArray(value.uiPermissions?.allowedTargetWorkflowStageIds);
  });
}

function pr05Stage(snapshot: Pr05KanbanSnapshotDto, displayName: 'Todo' | 'Done' | 'Cancelled'): Pr05KanbanColumnDto {
  const stage = snapshot.columns.find((candidate) => candidate.displayName === displayName);
  expect(stage, `${displayName} Workflow Stage is present in the real board response`).toBeTruthy();
  return stage!;
}

function pr05Card(snapshot: Pr05KanbanSnapshotDto, title: string): Pr05KanbanCardDto {
  const card = snapshot.cards.find((candidate) => candidate.summary === title);
  expect(card, `${title} is present in the real board response`).toBeTruthy();
  return card!;
}

function pr05CardLocator(page: Page, taskId: string): Locator {
  return page.locator(`[data-kanban-card-id="${taskId}"]`);
}

function pr05ColumnLocator(page: Page, displayName: 'Todo' | 'Done' | 'Cancelled'): Locator {
  return page.locator('.aip-kanban__column')
    .filter({ has: page.getByRole('heading', { name: displayName, exact: true }) });
}

function pr05StageTaskIds(snapshot: Pr05KanbanSnapshotDto, workflowStageId: string): string[] {
  return snapshot.cards
    .filter((card) => card.workflowStageId === workflowStageId)
    .sort((left, right) => left.boardOrder - right.boardOrder || left.taskId.localeCompare(right.taskId))
    .map((card) => card.taskId);
}

async function expectPr05StageOrder(
  page: Page,
  snapshot: Pr05KanbanSnapshotDto,
  displayName: 'Todo' | 'Done' | 'Cancelled'
): Promise<void> {
  const stage = pr05Stage(snapshot, displayName);
  const expectedIds = pr05StageTaskIds(snapshot, stage.workflowStageId);
  const cards = pr05ColumnLocator(page, displayName).locator('[data-kanban-card-id]');
  await expect(cards).toHaveCount(expectedIds.length);
  const actualIds = await cards.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset['kanbanCardId'] ?? '')
  );
  expect(actualIds, `${displayName} DOM order matches the authoritative boardOrder`).toEqual(expectedIds);
}

function expectCanonicalKanbanDenial(text: string, expectedCode: string): void {
  const body = parseJson(text) as Record<string, any>;
  expect(typeof body.requestId, 'safe Kanban denial requestId').toBe('string');
  expect(body.error?.code, 'safe Kanban denial error code').toBe(expectedCode);
  expect(text, 'safe Kanban denial must not expose protected board metadata').not.toMatch(
    /PR05 (?:real|stable|cancellation|stale)|tenantId|workspaceId|workflowStageId|boardVersion|sortKey|policy stamp|internal\//i
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  await clickTaskOpenDetail(page, taskRow);

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
  let projectListRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/projects') {
      projectListRequests += 1;
    }
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
  expect(projectListRequests, 'My Tasks must not request /api/projects while loading').toBe(0);
  evidence.steps.push({
    name: 'my-tasks-independent-from-project-list',
    method: 'GET',
    path: '/api/projects',
    status: projectListRequests
  });

  const taskButton = page.getByRole('button', { name: /^Browser smoke task(?:\s|$)/ }).first();
  await expect(taskButton).toBeVisible();
  await taskButton.click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${evidence.projectId}/tasks/${evidence.taskId}$`));
  await expect(page.getByTestId('task-detail-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: smokeTaskTitle })).toBeVisible();
}

async function clickTaskOpenDetail(page: Page, taskRow: Locator): Promise<void> {
  const action = taskRow.getByTestId('task-action-openDetail');
  if (!(await action.isVisible())) {
    await page.locator('.ag-body-horizontal-scroll-viewport').evaluate((viewport) => {
      viewport.scrollLeft = viewport.scrollWidth;
    });
  }

  await expect(action).toBeVisible();
  await action.click();
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

function waitForSuccessfulApiResponse(
  page: Page,
  method: string,
  path: string | RegExp
): Promise<PlaywrightResponse> {
  return page.waitForResponse((response) => {
    if (!response.ok() || response.request().method() !== method) {
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

async function fetchBinaryFromPage(page: Page, path: string): Promise<{ status: number; text: string }> {
  const response = await page.context().request.get(new URL(path, page.url()).href);
  return { status: response.status(), text: await response.text() };
}

async function requestBinaryWithCsrf(page: Page, path: string, body: unknown): Promise<{ status: number; text: string }> {
  const csrf = await page.evaluate(async () => {
    const response = await fetch('/api/security/csrf-token', { credentials: 'include' });
    return response.json() as Promise<{ token?: string; headerName?: string }>;
  });
  expect(csrf.token, 'binary request CSRF token').toBeTruthy();
  expect(csrf.headerName, 'binary request CSRF header name').toBeTruthy();
  const response = await page.context().request.post(new URL(path, page.url()).href, {
    data: body,
    headers: { [csrf.headerName!]: csrf.token! }
  });
  return { status: response.status(), text: await response.text() };
}

/** Acquires the anti-forgery token in the browser and never serializes it into evidence. */
async function requestWithCsrf(
  page: Page,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; text: string; csrfHeaderPresent: boolean }> {
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
    return {
      status: response.status,
      text: await response.text(),
      csrfHeaderPresent: Boolean(csrf.token && csrf.headerName && headers[csrf.headerName])
    };
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

function expectUnexpectedApiFailures(
  evidence: SmokeEvidence,
  scenarioExpectedFailures: readonly SmokeFailedApiResponse[] = []
) {
  const remainingScenarioExpected = [...scenarioExpectedFailures];
  const unexpected = evidence.failedApiResponses.filter((failure) => {
    if (isExpectedFailure(failure)) return false;
    const expectedIndex = remainingScenarioExpected.findIndex((expected) => sameFailure(failure, expected));
    if (expectedIndex < 0) return true;
    remainingScenarioExpected.splice(expectedIndex, 1);
    return false;
  });
  expect(unexpected, 'unexpected failed API responses').toEqual([]);
  expect(remainingScenarioExpected, 'scenario-expected failed API responses were not observed').toEqual([]);
}

function expectUnexpectedConsoleErrors(
  evidence: SmokeEvidence,
  scenarioExpectedFailures: readonly SmokeFailedApiResponse[] = []
) {
  const expectedNetworkFailures = new Map<number, number>();
  const remainingScenarioExpected = [...scenarioExpectedFailures];
  for (const failure of evidence.failedApiResponses) {
    let expected = isExpectedFailure(failure);
    if (!expected) {
      const expectedIndex = remainingScenarioExpected.findIndex((candidate) => sameFailure(failure, candidate));
      if (expectedIndex >= 0) {
        remainingScenarioExpected.splice(expectedIndex, 1);
        expected = true;
      }
    }
    if (!expected) continue;
    expectedNetworkFailures.set(failure.status, (expectedNetworkFailures.get(failure.status) ?? 0) + 1);
  }

  const unexpected = evidence.consoleErrors.filter((message) => {
    const match = /Failed to load resource:.*status of (\d{3})/i.exec(message);
    if (!match) return true;
    const status = Number(match[1]);
    const remaining = expectedNetworkFailures.get(status) ?? 0;
    if (remaining === 0) return true;
    expectedNetworkFailures.set(status, remaining - 1);
    return false;
  });
  expect(unexpected, 'unexpected browser console errors').toEqual([]);
}

function sameFailure(left: SmokeFailedApiResponse, right: SmokeFailedApiResponse): boolean {
  return left.method === right.method && left.path === right.path && left.status === right.status;
}

function expectSafeProjectDetailDenial(
  text: string,
  protectedValues: readonly string[]
): Record<string, unknown> {
  const body = parseJson(text) as Record<string, unknown>;
  expect(body).toMatchObject({ code: 'BadRequest', message: 'Project not found.' });
  expect(typeof body.traceId, 'safe Project denial traceId').toBe('string');
  for (const protectedValue of protectedValues) {
    expect(text, 'safe Project denial must not expose protected Project data').not.toContain(protectedValue);
  }
  return body;
}

function expectOnlyExpectedPr06HubConsoleErrors(evidence: SmokeEvidence) {
  const unexpected = evidence.consoleErrors.filter((message) =>
    !/Synthetic PR06 Hub unavailability|Failed to complete negotiation with the server|Failed to start the connection/i
      .test(message)
  );
  expect(unexpected, 'unexpected SignalR-degraded browser console errors').toEqual([]);
}

function isExpectedFailure(failure: SmokeFailedApiResponse): boolean {
  return (
    (failure.method === 'POST' && failure.path === '/api/auth/change-password' && failure.status === 403) ||
    (failure.method === 'POST' && failure.path === '/api/auth/change-password' && failure.status === 400) ||
    (failure.method === 'GET' && failure.path === '/api/auth/me' && failure.status === 401) ||
    (failure.method === 'GET' && failure.path === '/api/projects' && failure.status === 401) ||
    (failure.method === 'GET' && failure.path === '/api/me/tasks' && failure.status === 400) ||
    (failure.method === 'GET' && failure.path === '/api/me/tasks' && failure.status === 403) ||
    (failure.method === 'GET' && failure.path === '/api/me/tasks/counts' && failure.status === 403) ||
    (failure.method === 'POST' && /^\/api\/tasks\/[0-9a-f-]+\/kanban-move$/i.test(failure.path) && failure.status === 409) ||
    (failure.method === 'GET' && /^\/api\/projects\/[0-9a-f-]+\/kanban$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'PATCH' && /^\/api\/tasks\/[0-9a-f-]+\/(?:schedule|progress)$/i.test(failure.path) && failure.status === 409) ||
    (failure.method === 'GET' && /^\/api\/projects\/[0-9a-f-]+\/gantt$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'GET' && /^\/api\/tasks\/[0-9a-f-]+$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'POST' && /^\/api\/attachments\/[0-9a-f-]+\/download-grants$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'GET' && /^\/api\/attachments\/[0-9a-f-]+\/download$/i.test(failure.path) && failure.status === 400) ||
    (failure.method === 'POST' && /^\/api\/attachment-download-grants\/[0-9a-f-]+\/download$/i.test(failure.path) && failure.status === 400)
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

interface Pr06GanttEvidence extends SmokeEvidence {
  featureFlagEnabled?: boolean;
  readonly seed: {
    readonly projectSlug: string;
    readonly projectTitle: string;
    readonly taskTitles: readonly string[];
    readonly milestoneTitle: string;
  };
  readonly apiInterception: 'none';
  readonly hubTransportFaultInjection: string;
  readonly commands: Pr06GanttCommandEvidence[];
  viewerReadOnly?: {
    userId: string;
    snapshotStatus: number;
    permissions: Pr06GanttPermissionsDto;
    editActionCount: 0;
    pageErrors: string[];
    consoleErrors: string[];
    failedApiResponses: SmokeFailedApiResponse[];
  };
  dependencyNoCascade?: {
    successorTaskId: string;
    before: {
      plannedStartDate: string | null;
      plannedEndDate: string | null;
    };
    after: {
      plannedStartDate: string | null;
      plannedEndDate: string | null;
    };
  };
  degradedHttp?: {
    connectionState: 'delayed';
    commandStatus: number;
    manualRefreshStatus: number;
    apiInterception: 'none';
    pageErrors: string[];
    consoleErrors: string[];
    failedApiResponses: SmokeFailedApiResponse[];
  };
  staleConflict?: {
    taskId: string;
    staleVersion: number;
    concurrentVersion: number;
    code: string | undefined;
    status: number;
    authoritativeVersion: number;
    authoritativeDates: {
      plannedStartDate: string | null;
      plannedEndDate: string | null;
    };
    optimisticDateTransitions: string[];
    intentPreserved: true;
    focusRestored: true;
  };
  reloadPersistence?: {
    scheduleTaskUnscheduled: true;
    progressPercent: number;
    degradedProgressPercent: number;
    milestoneDate: string;
    conflictDates: [string, string];
    removedDependencyAbsent: true;
  };
  authorizationRevocation?: {
    revokingActorUserId: string;
    revokedUserId: string;
    revokeStatus: number;
    overlappingRefreshStatus: number;
    projectDetailDenialStatus: number;
    projectDetailDenialCode: string;
    denialStatus: number;
    subsequentDenialStatus: number;
    protectedDataClearedBeforeRevalidation: boolean;
    protectedDataRestoredByStaleResponse: boolean;
    revokingPageErrors: string[];
    revokingConsoleErrors: string[];
    revokingFailedApiResponses: SmokeFailedApiResponse[];
  };
}

interface Pr06GanttCommandEvidence {
  name: string;
  method: string;
  path: string;
  status: number;
  request: Record<string, unknown>;
  csrfHeaderPresent: boolean;
}

interface Pr06GanttWarningDto {
  code: string;
  message: string;
  severity: 'Info' | 'Warning';
  targetType: string;
  targetId: string | null;
  field: string | null;
  blocking: false;
}

interface Pr06GanttPermissionsDto {
  canEditSchedule: boolean;
  canEditProgress: boolean;
  canManageDependencies: boolean;
  canClearSchedule: boolean;
  canOpen: boolean;
}

interface Pr06GanttItemDto {
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
  stageCategory: string;
  priority: string;
  isBlocked: boolean;
  primaryAssignee: { userId: string; displayName: string } | null;
  version: number;
  scheduleEditPermissions: Pr06GanttPermissionsDto;
  warnings: Pr06GanttWarningDto[];
}

interface Pr06GanttDependencyDto {
  dependencyId: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type: 'FinishToStart' | 'StartToStart' | 'FinishToFinish' | 'StartToFinish';
  editable: boolean;
  version: number;
  warnings: Pr06GanttWarningDto[];
}

interface Pr06GanttSnapshotDto {
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
  scheduledItems: Pr06GanttItemDto[];
  unscheduledItems: Pr06GanttItemDto[];
  milestones: Pr06GanttItemDto[];
  dependencies: Pr06GanttDependencyDto[];
  warnings: Pr06GanttWarningDto[];
  permissions: Pr06GanttPermissionsDto;
  maximumItems: number;
  totalItems: number;
}

interface Pr05KanbanEvidence extends SmokeEvidence {
  tenantId?: string;
  featureFlagEnabled?: boolean;
  readonly seed: {
    readonly projectSlug: string;
    readonly projectTitle: string;
    readonly taskTitles: readonly string[];
  };
  readonly apiInterception: 'none';
  readonly featureFallback: string;
  readonly commands: Pr05KanbanCommandEvidence[];
  initialSnapshot?: {
    responseUrl: string;
    status: number;
    tenantId: string;
    workspaceId: string;
    projectId: string;
    boardVersion: number;
    taskIds: Record<string, string>;
    taskVersions: Record<string, number>;
    stages: Record<'todo' | 'done' | 'cancelled', string>;
    totalAuthorizedCardCount: number;
    isTruncated: boolean;
    canConfigure: boolean;
  };
  reorderPersistence?: {
    taskId: string;
    beforeTaskId: string;
    boardVersion: number;
    boardOrder: number;
    persistedOrder: string[];
  };
  movePersistence?: {
    taskId: string;
    workflowStageId: string;
    boardVersion: number;
    taskVersion: number;
    boardOrder: number;
  };
  reasonRequired?: {
    taskId: string;
    escapeSentPost: false;
    cancelSentPost: false;
    focusRestored: true;
    submittedReason: string;
    persistedWorkflowStageId: string;
  };
  staleConflict?: {
    taskId: string;
    staleTaskVersion: number;
    staleBoardVersion: number;
    concurrentBoardVersion: number;
    status: number;
    code: string | undefined;
    refetchedBoardVersion: number;
    rolledBackWorkflowStageId: string;
    optimisticStageTransitions: string[];
    focusRestored: true;
  };
  authorizationRevocation?: {
    revokingActorUserId: string;
    revokedUserId: string;
    revokeStatus: number;
    csrfHeaderPresent: boolean;
    overlappingRefreshStatus: number;
    projectDetailDenialStatus: number;
    projectDetailDenialCode: string;
    staleAuthorizedResponseUrl: string;
    responseGateStatusCode: number;
    denialUrl: string;
    denialStatus: number;
    subsequentDenialStatus: number;
    protectedDataClearedBeforeRevalidation: boolean;
    protectedDataRestoredByStaleResponse: boolean;
  };
}

interface Pr05KanbanCommandEvidence {
  name: string;
  responseUrl: string;
  status: number;
  taskId: string;
  expectedTaskVersion: number;
  expectedBoardVersion: number;
  authoritativeBoardVersion?: number;
  targetWorkflowStageId: string;
  targetBeforeTaskId: string | null;
  targetAfterTaskId: string | null;
  reason?: string | null;
  csrfHeaderPresent: boolean;
}

interface Pr05KanbanSnapshotDto {
  board: {
    projectId: string;
    version: number;
    totalAuthorizedCardCount: number;
    isTruncated: boolean;
    uiPermissions: { canConfigure: boolean };
    warnings: unknown[];
  };
  columns: Pr05KanbanColumnDto[];
  cards: Pr05KanbanCardDto[];
}

interface Pr05KanbanColumnDto {
  workflowStageId: string;
  displayName: string;
  category: number | string;
  displayOrder: number;
  wipWarningLimit: number | null;
  currentAuthorizedCardCount: number;
  hasWipWarning: boolean;
  uiPermissions: { canConfigure: boolean };
}

interface Pr05KanbanCardDto {
  taskId: string;
  summary: string;
  workflowStageId: string;
  boardOrder: number;
  version: number;
  uiPermissions: {
    canOpen: boolean;
    canMove: boolean;
    allowedTargetWorkflowStageIds: string[];
  };
}

interface Pr05KanbanCommandResponseDto {
  snapshot: Pr05KanbanSnapshotDto;
  focusTaskId: string | null;
  warnings: unknown[];
}
