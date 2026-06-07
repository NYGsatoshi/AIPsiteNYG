import { AuthApi, DashboardApi, UiApi } from "../api.js";
import { renderNavigation } from "./navigation.js";
import { renderNotificationArea, renderNotificationButton } from "./notification-indicator.js";
import { renderUserMenu } from "./user-menu.js";
import { qs, routeTo } from "../utils.js";

async function refreshNotifications(root) {
  let unreadCount = 0;
  try {
    const unread = await DashboardApi.unreadCount();
    unreadCount = unread.unreadCount ?? 0;
  } catch {
    unreadCount = 0;
  }

  renderNotificationButton(qs("[data-notification-button]", root), unreadCount);
}

export async function showLogin(root) {
  root.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card" aria-live="polite">
        <p class="eyebrow">AIP Portal</p>
        <h1>Sign in</h1>
        <form id="login-form" class="stack">
          <label>
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <button class="primary-action" type="submit">Sign in</button>
          <p id="login-message" class="form-message" role="status"></p>
        </form>
      </section>
    </main>
  `;

  qs("#login-form", root).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = qs("#login-message", root);
    message.textContent = "";

    try {
      await AuthApi.login(form.get("email"), form.get("password"));
      location.href = "/";
    } catch {
      message.textContent = "Sign in failed.";
    }
  });
}

export async function createShell(root) {
  const user = await AuthApi.me();
  let modules = [];

  try {
    modules = await UiApi.modules();
  } catch {
    // TODO: Replace the static fallback once FeatureModule authorization is fully enforced by the API.
    modules = [];
  }

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <button class="icon-button sidebar-toggle" type="button" aria-label="Toggle navigation" data-sidebar-toggle>
          <span>=</span>
        </button>
        <div class="brand-block">
          <strong>AIP Portal</strong>
          <span data-context-label>All workspaces</span>
        </div>
        <form class="search-entry" role="search" data-search-form>
          <input name="q" type="search" placeholder="Search" aria-label="Search">
        </form>
        <button class="radial-placeholder" type="button" aria-label="Radial menu" disabled>+</button>
        <div data-notification-button></div>
        <div data-user-menu></div>
      </header>
      <aside class="app-sidebar" data-sidebar></aside>
      <main id="main" class="main-content" tabindex="-1"></main>
      <aside class="app-notifications" data-notification-area></aside>
    </div>
  `;

  renderNavigation(qs("[data-sidebar]", root), modules, user);
  await refreshNotifications(root);
  renderUserMenu(qs("[data-user-menu]", root), user);
  renderNotificationArea(qs("[data-notification-area]", root));

  qs("[data-sidebar-toggle]", root).addEventListener("click", () => {
    qs(".app-shell", root).classList.toggle("is-sidebar-open");
  });

  qs("[data-search-form]", root).addEventListener("submit", (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("q");
    if (query) routeTo(`/search?q=${encodeURIComponent(query)}`);
  });

  window.addEventListener("aip:notifications-changed", () => {
    refreshNotifications(root);
    renderNotificationArea(qs("[data-notification-area]", root));
  });
  window.setInterval(() => refreshNotifications(root), 45000);

  return { user, modules };
}
