import { type Page, type Route } from "@playwright/test";

export const projectTasksRoute = "**/api/projects/project-ui-test/tasks";

const uiTestProject = {
  id: "project-ui-test",
  title: "UI Test Project",
  description: "Stable mocked project for Playwright coverage.",
  status: 1,
  groupId: null,
  startDate: "2026-06-01",
  endDate: "2026-07-31",
  progressPercent: 25
};

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload)
  });
}

function listResponse(items: unknown[] = []) {
  return { items, page: 1, pageSize: 50, totalCount: items.length };
}

async function useEnglishLocale(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("aip.locale", "en-US");
  });
}

async function mockCsrf(page: Page) {
  await page.route("**/api/security/csrf-token", (route) =>
    fulfillJson(route, { token: "ui-test-csrf-token", headerName: "X-CSRF-Token" })
  );
}

export async function mockLoginOnly(page: Page) {
  await useEnglishLocale(page);
  await mockCsrf(page);
  await page.route("**/api/auth/status", (route) => fulfillJson(route, { isAuthenticated: false }));
  await page.route("**/api/auth/login", (route) =>
    fulfillJson(route, { error: "Invalid email or password." }, 401)
  );
}

export async function mockAuthenticatedApp(page: Page) {
  await useEnglishLocale(page);
  await mockCsrf(page);

  await page.route("**/api/auth/status", (route) => fulfillJson(route, { isAuthenticated: true }));
  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, {
      id: "ui-test-user",
      displayName: "UI Test User",
      email: "ui-test@example.invalid",
      systemRole: 1
    })
  );
  await page.route("**/api/auth/logout", (route) => fulfillJson(route, { ok: true }));
  await page.route("**/api/ui/modules", (route) => fulfillJson(route, []));
  await page.route("**/api/tenants/current", (route) =>
    fulfillJson(route, {
      tenantId: "tenant-ui-test",
      tenantSlug: "ui-test",
      displayName: "UI Test Tenant",
      status: 0,
      currentUserRole: 3,
      appMode: 0,
      allowTenantSwitching: false
    })
  );

  await page.route("**/api/notifications/unread-count", (route) => fulfillJson(route, { unreadCount: 0 }));
  await page.route(/\/api\/notifications(?:\?|$)/, (route) => fulfillJson(route, listResponse([])));
  await page.route(/\/api\/announcements(?:\?|$)/, (route) => fulfillJson(route, listResponse([])));
  await page.route(/\/api\/me\/tasks\?/, (route) => fulfillJson(route, listResponse([])));
  await page.route("**/api/conversations", (route) => fulfillJson(route, listResponse([])));
  await page.route(/\/api\/calendar\?/, (route) => fulfillJson(route, listResponse([])));
  await page.route("**/api/projects", (route) => fulfillJson(route, listResponse([uiTestProject])));

  await page.route("**/api/projects/project-ui-test", (route) => fulfillJson(route, uiTestProject));
  await page.route("**/api/projects/project-ui-test/dashboard", (route) =>
    fulfillJson(route, {
      taskCountsByStatus: [],
      overdueTaskCount: 0,
      recentActivityLogs: [],
      latestArtifacts: []
    })
  );
  await page.route(projectTasksRoute, (route) => {
    if (route.request().method() === "POST") {
      return fulfillJson(route, { id: "task-ui-test", title: "Valid UI task" }, 201);
    }

    return fulfillJson(route, listResponse([]));
  });
}
