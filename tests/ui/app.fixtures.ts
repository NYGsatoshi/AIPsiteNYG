import type { Page, Route } from '@playwright/test';

const user = {
  id: 'ui-test-user',
  email: 'tester@example.invalid',
  displayName: 'UI Test User',
  systemRole: 'User'
};

const tenant = {
  tenantId: 'tenant-ui-test',
  tenantSlug: 'default',
  displayName: 'Default Tenant',
  status: 'Active',
  appMode: 'SaaS',
  currentUserRole: 'Member',
  allowTenantSwitching: false
};

const project = {
  id: 'project-ui-test',
  title: 'UI Test Project',
  description: 'Stable project fixture for UI tests.',
  status: 1,
  groupId: null,
  startDate: '2026-06-01T00:00:00Z',
  endDate: '2026-06-30T00:00:00Z',
  progressPercent: 20
};

const routes: Record<string, unknown> = {
  '/api/auth/status': { isAuthenticated: true },
  '/api/auth/me': user,
  '/api/ui/modules': [],
  '/api/tenants/current': tenant,
  '/api/notifications/unread-count': { unreadCount: 0 },
  '/api/notifications?page=1&pageSize=5': { items: [] },
  '/api/announcements?page=1&pageSize=5': { items: [] },
  '/api/me/tasks?dueBefore=*': { items: [] },
  '/api/conversations': { items: [] },
  '/api/calendar?fromDate=*&toDate=*': { items: [] },
  '/api/projects': { items: [project] },
  '/api/projects/project-ui-test': project,
  '/api/projects/project-ui-test/dashboard': {
    taskCountsByStatus: [],
    overdueTaskCount: 0,
    recentActivityLogs: [],
    latestArtifacts: []
  },
  '/api/projects/project-ui-test/tasks': { items: [] },
  '/api/projects/project-ui-test/gantt': { tasks: [] },
  '/api/projects/project-ui-test/members': { items: [] },
  '/api/projects/project-ui-test/artifacts': { items: [] },
  '/api/comments?targetType=2&targetId=project-ui-test': { items: [] }
};

function routeMatches(pattern: string, url: URL) {
  const actual = `${url.pathname}${url.search}`;
  if (pattern.endsWith('*')) {
    return actual.startsWith(pattern.slice(0, -1));
  }

  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(actual);
  }

  return actual === pattern;
}

export async function mockAuthenticatedApp(page: Page) {
  await page.route('/api/security/csrf-token', async (route) => {
    await route.fulfill({ json: { token: 'ui-test-csrf-token', headerName: 'X-CSRF-Token' } });
  });

  await page.route('/api/auth/login', async (route) => {
    const body = route.request().postDataJSON() as { email?: string; password?: string };
    if (body.email === 'bad@example.invalid') {
      await route.fulfill({ status: 401, json: { error: 'Invalid email or password.' } });
      return;
    }

    await route.fulfill({ json: { isAuthenticated: true, user } });
  });

  await page.route('/api/projects/project-ui-test/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 201, json: { id: 'task-ui-test', title: 'Created task' } });
      return;
    }

    await route.fulfill({ json: { items: [] } });
  });

  await page.route('/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const match = Object.entries(routes).find(([pattern]) => routeMatches(pattern, url));
    if (!match) {
      await route.fulfill({ status: 404, json: { error: `No UI test mock for ${url.pathname}${url.search}` } });
      return;
    }

    await route.fulfill({ json: match[1] });
  });
}

export async function mockLoginOnly(page: Page) {
  await page.route('/api/auth/status', async (route) => route.fulfill({ json: { isAuthenticated: false } }));
  await page.route('/api/security/csrf-token', async (route) => {
    await route.fulfill({ json: { token: 'ui-test-csrf-token', headerName: 'X-CSRF-Token' } });
  });
  await page.route('/api/auth/login', async (route) => route.fulfill({ status: 401, json: { error: 'Invalid email or password.' } }));
}
