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
      await expect(page.getByText('Project board not found', { exact: true })).toBeVisible();
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
      expectUnexpectedConsoleErrors(evidence);
      expectUnexpectedApiFailures(evidence);
    } finally {
      await ownerContext?.close();
      await testInfo.attach('task-v1-pr05-real-backend-evidence.json', {
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
  method: 'POST' | 'DELETE',
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

function expectUnexpectedApiFailures(evidence: SmokeEvidence) {
  const unexpected = evidence.failedApiResponses.filter((failure) => !isExpectedFailure(failure));
  expect(unexpected, 'unexpected failed API responses').toEqual([]);
}

function expectUnexpectedConsoleErrors(evidence: SmokeEvidence) {
  const expectedNetworkFailures = new Map<number, number>();
  for (const failure of evidence.failedApiResponses.filter(isExpectedFailure)) {
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
