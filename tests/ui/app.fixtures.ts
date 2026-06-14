import type { Page, Route } from '@playwright/test';

const user = {
  id: 'user-ui-test',
  displayName: 'UI Test User',
  email: 'ui-test@example.invalid',
  systemRole: 'Admin'
};

const tenant = {
  tenantId: 'tenant-ui-test',
  id: 'tenant-ui-test',
  tenantSlug: 'ui-test',
  displayName: 'UI Test Tenant',
  currentUserRole: 'Owner',
  status: 'Active',
  appMode: 'SaaS',
  allowTenantSwitching: false
};

const project = {
  id: 'project-ui-test',
  title: 'UI Test Project',
  description: 'Stable mocked project for UI tests.',
  status: 1,
  groupId: null,
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  progressPercent: 25
};

async function json(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  });
}

export async function mockLoginOnly(page: Page) {
  await page.route('/api/security/csrf-token', (route) => json(route, { token: 'ui-test-csrf-token', headerName: 'X-CSRF-Token' }));
  await page.route('/api/auth/status', (route) => json(route, { isAuthenticated: false }));
  await page.route('/api/auth/login', (route) => json(route, { error: 'Invalid email or password.' }, 401));
}

export async function mockAuthenticatedApp(page: Page) {
  await page.route('/api/security/csrf-token', (route) => json(route, { token: 'ui-test-csrf-token', headerName: 'X-CSRF-Token' }));
  await page.route('/api/auth/status', (route) => json(route, { isAuthenticated: true }));
  await page.route('/api/auth/me', (route) => json(route, user));
  await page.route('/api/auth/logout', (route) => json(route, {}));
  await page.route('/api/ui/modules', (route) => json(route, []));
  await page.route('/api/tenants/current', (route) => json(route, tenant));
  await page.route('/api/tenants/my', (route) => json(route, [tenant]));
  await page.route('/api/notifications/unread-count', (route) => json(route, { unreadCount: 0 }));
  await page.route(/\/api\/notifications\?page=1&pageSize=5/, (route) => json(route, { items: [] }));
  await page.route(/\/api\/announcements\?page=1&pageSize=5/, (route) => json(route, { items: [] }));
  await page.route(/\/api\/me\/tasks\?dueBefore=.*/, (route) => json(route, { items: [] }));
  await page.route('/api/conversations', (route) => json(route, { items: [] }));
  await page.route(/\/api\/calendar\?fromDate=.*/, (route) => json(route, { items: [] }));
  await page.route('/api/projects', (route) => json(route, { items: [project] }));
  await page.route('/api/projects/project-ui-test', (route) => json(route, project));
  await page.route('/api/projects/project-ui-test/dashboard', (route) => json(route, {
    taskCountsByStatus: [],
    overdueTaskCount: 0,
    recentActivityLogs: [],
    latestArtifacts: []
  }));
  await page.route('/api/projects/project-ui-test/tasks', (route) => json(route, { items: [] }));
}
