import { ApiError } from "./api.js";
import { createShell, showLogin } from "./components/shell.js";
import { renderOnPremOnboarding, renderPlatformAdmin, renderTenantAdmin } from "./pages/admin.js";
import { renderAnnouncements } from "./pages/announcements.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderMessaging } from "./pages/messaging.js";
import { renderNotifications } from "./pages/notifications.js";
import { renderProjectDetail, renderProjects } from "./pages/projects.js";
import { renderPlaceholder, renderSearch } from "./pages/placeholders.js";
import { qs, routeTo } from "./utils.js";

const root = document.getElementById("app");
let shellState = null;

// TODO: Add frontend tests for navigation, dashboard empty states, notification badges, and admin visibility once a frontend test harness is chosen.
async function boot() {
  try {
    shellState = await createShell(root);
    await renderRoute();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await showLogin(root);
      return;
    }

    root.innerHTML = `<main class="auth-screen"><section class="auth-card"><h1>AIP Portal</h1><p>Unable to start the app.</p></section></main>`;
  }
}

async function renderRoute() {
  const main = qs("#main", root);
  if (!main) return;

  const path = location.pathname;
  if (path === "/") {
    renderDashboard(main, shellState);
  } else if (path === "/projects") {
    await renderProjects(main);
  } else if (path.startsWith("/projects/")) {
    await renderProjectDetail(main, path.split("/")[2]);
  } else if (path === "/dm") {
    await renderMessaging(main, shellState, null);
  } else if (path.startsWith("/dm/")) {
    await renderMessaging(main, shellState, path.split("/")[2]);
  } else if (path === "/notifications") {
    await renderNotifications(main);
  } else if (path === "/announcements") {
    await renderAnnouncements(main, shellState, null);
  } else if (path.startsWith("/announcements/")) {
    await renderAnnouncements(main, shellState, path.split("/")[2]);
  } else if (path === "/search") {
    renderSearch(main);
  } else if (path === "/tenant-admin") {
    await renderTenantAdmin(main, shellState);
  } else if (path === "/platform-admin") {
    await renderPlatformAdmin(main);
  } else if (path === "/onboarding") {
    renderOnPremOnboarding(main, shellState);
  } else {
    renderPlaceholder(main, path);
  }

  main.focus({ preventScroll: true });
  root.querySelectorAll("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      routeTo(link.getAttribute("href"));
    });
  });
}

window.addEventListener("popstate", renderRoute);
window.addEventListener("aip:navigate", renderRoute);

boot();
