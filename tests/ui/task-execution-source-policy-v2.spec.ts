import { expect, type Page, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

const PROJECT_ID = 'static-project-source-policy-v2';
const TASK_ID = 'static-task-source-policy-v2';

type SourceState = 'Allow' | 'Prioritize' | 'Exclude';

type SourcePolicyV2 = {
  schemaVersion: 2;
  web: SourceState;
  webSite: SourceState;
  projectFile: SourceState;
  connectedApp: SourceState;
  items: readonly { kind: 'Web' | 'WebSite' | 'ProjectFile' | 'ConnectedApp'; sourceId: string; state: SourceState }[];
};

test.describe('Issue #361 Source Policy V2 Angular smoke', () => {
  test('keeps the four-kind tri-state policy responsive without starting a runtime', async ({ page }) => {
    await installDirectTaskContextApi(page);
    const api = await installSourcePolicyV2Api(page);
    await page.setViewportSize({ width: 320, height: 900 });

    await page.goto(`/app/projects/${PROJECT_ID}/tasks/${TASK_ID}`);

    const scope = page.getByTestId('task-execution-scope');
    await expect(scope).toBeVisible();
    const summary = scope.getByTestId('task-context-summary');
    await expect(summary).toContainText('1 of 4 source kinds eligible');
    await expect(summary.getByTestId('task-context-summary-origin')).toContainText('Task override');
    await expect(summary.getByTestId('task-context-summary-web')).toHaveText('Web: Allow');
    await expect(summary.getByTestId('task-context-summary-files')).toHaveText('Project files: Exclude');
    await expect(summary).toContainText('never a hidden inventory count');

    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(scope.getByTestId('task-context-details')).toBeFocused();
    await expect(scope.getByTestId('task-execution-scope-web-policy')).toContainText('Allow');
    await expect(scope.getByTestId('task-execution-scope-web-policy')).toContainText('Eligible for the next run.');
    await expect(scope.getByTestId('task-execution-scope-files-policy')).toContainText('Exclude');
    await expect(scope.getByTestId('task-execution-scope-files-policy')).toContainText('Not eligible and never materialized.');
    await expect(scope.getByTestId('task-execution-scope-sites')).toContainText('Exclude');
    await expect(scope.getByTestId('task-execution-scope-apps')).toContainText('Exclude');
    await expect(scope.getByTestId('task-execution-scope-future-only')).toContainText('immutable resolved policy snapshot');
    await expect(scope.getByTestId('task-execution-runtime-contract')).toContainText('fails closed');
    await expect(scope.getByTestId('task-execution-snapshot')).toContainText('Project files at request');
    await expect(scope.getByTestId('task-execution-snapshot')).toContainText('Prioritize');
    await expect(scope.getByRole('heading', { name: 'Source policy' })).toBeVisible();

    await expect(scope.getByRole('button', { name: /start|run|execute/i })).toHaveCount(0);
    await expect(scope.locator('a[href^="http"]')).toHaveCount(0);
    await expect(scope.locator('[name="provider"], [name="webUrl"], textarea')).toHaveCount(0);
    await expect(scope.getByLabel('Project default Web policy')).toHaveValue('Exclude');
    await expect(scope.getByLabel('Project default ProjectFile policy')).toHaveValue('Allow');
    await expect(scope.getByLabel('Task override Web policy')).toHaveValue('Allow');
    await expect(scope.getByLabel('Task override ProjectFile policy')).toHaveValue('Exclude');

    await scope.getByLabel('Project default Web policy').selectOption('Prioritize');
    await scope.getByRole('button', { name: 'Save Project default' }).click();
    await expect(scope.getByTestId('task-execution-scope-feedback')).toContainText('Project default source policy saved.');
    await expect.poll(() => api.projectUpdates().length).toBe(1);
    expect(api.projectUpdates()).toEqual([
      {
        webEnabled: true,
        projectFilesEnabled: true,
        expectedVersion: 8,
        policyV2: {
          schemaVersion: 2,
          web: 'Prioritize',
          webSite: 'Exclude',
          projectFile: 'Allow',
          connectedApp: 'Exclude',
          items: [],
        },
      },
    ]);
    expect(api.runtimeRequests()).toEqual([]);

    // A complete Task override remains authoritative after the Project default changes.
    await expect(scope.getByTestId('task-execution-scope-origin')).toHaveText('Task override');
    await expect(scope.getByTestId('task-execution-scope-web-policy')).toContainText('Allow');
    await expect(scope.getByTestId('task-execution-scope-files-policy')).toContainText('Exclude');

    await expectNoDocumentHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page, '[data-testid="task-execution-scope"]');
    await expectHealthyAngularPage(page);
  });
});

async function installDirectTaskContextApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }

    if (path === `/api/tasks/${TASK_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          task: {
            id: TASK_ID,
            tenantId: 'mock-tenant',
            workspaceId: 'static-workspace-1',
            projectId: PROJECT_ID,
            kind: 0,
            parentTaskId: null,
            milestoneId: null,
            title: 'Source Policy V2 Task',
            description: 'Synthetic direct-route context for Issue #361.',
            workflowStageId: 'stage-in-progress',
            workflowStageName: 'In progress',
            status: 1,
            stageCategory: 1,
            isBlocked: false,
            priority: 'High',
            plannedStartDate: '2026-09-01',
            plannedEndDate: '2026-09-02',
            progressPercent: 40,
            progressIsDerived: false,
            primaryAssignee: { userId: 'mock-user-a', displayName: 'Mock User A' },
            reviewStatus: 0,
            version: 1,
            uiPermissions: { canEdit: false, canAssign: false, canChangeStatus: false, canDelete: false, allowedTransitions: [] },
          },
          relationships: { primaryAssignee: { userId: 'mock-user-a', displayName: 'Mock User A' }, collaborators: [], reviewer: null, version: 1 },
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
            canChangeWatch: false,
          },
          checklist: [],
          labels: [],
          watchState: { isWatching: false, isExplicitOptOut: false, automaticSources: [], version: 1 },
          subtasks: { items: [], page: 1, pageSize: 50, totalCount: 0, hasMore: false },
          comments: { items: [], page: 1, pageSize: 20, totalCount: 0, hasMore: false },
          files: { items: [], page: 1, pageSize: 20, totalCount: 0, hasMore: false },
        }),
      });
      return;
    }

    if (path === `/api/projects/${PROJECT_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: PROJECT_ID,
          title: 'Source Policy V2 Project',
          status: 1,
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          updatedAt: '2026-09-01T00:00:00Z',
          uiPermissions: { canCreateTask: false },
        }),
      });
      return;
    }

    if (path === '/api/projects') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], page: 1, pageSize: 50, totalCount: 0, hasMore: false }),
      });
      return;
    }

    await route.fallback();
  });
}

async function installSourcePolicyV2Api(page: Page) {
  let projectVersion = 8;
  let projectPolicy: SourcePolicyV2 = {
    schemaVersion: 2,
    web: 'Exclude',
    webSite: 'Exclude',
    projectFile: 'Allow',
    connectedApp: 'Exclude',
    items: [],
  };
  const taskPolicy: SourcePolicyV2 = {
    schemaVersion: 2,
    web: 'Allow',
    webSite: 'Exclude',
    projectFile: 'Exclude',
    connectedApp: 'Exclude',
    items: [],
  };
  const updates: Record<string, unknown>[] = [];
  const runtimeRequests: { method: string; path: string }[] = [];

  const compatibility = (policy: SourcePolicyV2) => ({
    webEnabled: policy.web !== 'Exclude',
    projectFilesEnabled: policy.projectFile !== 'Exclude' || policy.items.some((rule) => rule.kind === 'ProjectFile' && rule.state !== 'Exclude'),
    policyV2: policy,
  });

  const projectResponse = () => ({
    policy: compatibility(projectPolicy),
    version: projectVersion,
    canManage: true,
  });
  const taskResponse = () => ({
    effectivePolicy: compatibility(taskPolicy),
    origin: 'TaskOverride',
    projectDefaultVersion: projectVersion,
    taskOverrideVersion: 5,
    taskOverridePolicy: compatibility(taskPolicy),
    canManage: true,
    latestRun: {
      id: 'static-run-source-policy-v2',
      status: 'Accepted',
      majorState: 'Accepted',
      requestedAtUtc: '2026-09-01T00:00:00Z',
      snapshotSchemaVersion: 3,
      snapshotScopeOrigin: 'ProjectDefault',
      snapshotProjectScopeVersion: 7,
      snapshotTaskOverrideVersion: null,
      snapshotWebEnabled: false,
      snapshotProjectFilesEnabled: true,
      snapshotPolicyV2: {
        schemaVersion: 2,
        web: 'Exclude',
        webSite: 'Exclude',
        projectFile: 'Prioritize',
        connectedApp: 'Exclude',
        items: [],
      },
    },
    sourceInventory: [],
    changesApplyTo: 'nextRun',
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/security/csrf-token' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'csrf-source-policy-v2', headerName: 'X-CSRF-Token' }),
      });
      return;
    }

    if (path === `/api/projects/${PROJECT_ID}/execution-scope`) {
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectResponse()) });
        return;
      }
      if (method === 'PUT') {
        const body = request.postDataJSON() as Record<string, unknown>;
        updates.push(body);
        const candidate = body['policyV2'] as SourcePolicyV2 | undefined;
        if (!candidate || candidate.schemaVersion !== 2 || body['expectedVersion'] !== projectVersion) {
          throw new Error('Unexpected Source Policy V2 Project update.');
        }
        projectPolicy = candidate;
        projectVersion += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectResponse()) });
        return;
      }
    }

    if (path === `/api/tasks/${TASK_ID}/execution-scope` && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(taskResponse()) });
      return;
    }

    if (path === `/api/tasks/${TASK_ID}/execution-runs`) {
      runtimeRequests.push({ method, path });
      throw new Error('Source Policy V2 settings must never start an execution run.');
    }

    await route.fallback();
  });

  return {
    projectUpdates: () => updates,
    runtimeRequests: () => runtimeRequests,
  };
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth);
}

async function expectHealthyAngularPage(page: Page): Promise<void> {
  const body = page.locator('body');
  await expect(body).not.toContainText('Cannot GET /');
  await expect(body).not.toContainText('Application error');
  await expect(body).not.toContainText(/NG0\d+/);
  await expect(body).not.toContainText('TypeError');
  await expect(page.locator('app-root')).toBeAttached();
}
