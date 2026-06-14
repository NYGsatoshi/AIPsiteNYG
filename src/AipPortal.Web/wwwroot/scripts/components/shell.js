import { AuthApi, DashboardApi, TenantApi, UiApi } from "../api.js";
import { renderNavigation } from "./navigation.js";
import { renderNotificationArea, renderNotificationButton } from "./notification-indicator.js";
import { renderUserMenu } from "./user-menu.js";
import { enumLabel } from "../enums.js";
import { escapeHtml, qs, routeTo } from "../utils.js";
import { bindLanguageSelectors, renderLanguageSelector, t } from "../i18n/index.js";

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

function renderTenantContext(container, currentTenant, myTenants) {
  if (!container) return;

  if (!currentTenant) {
    container.innerHTML = `<span class="tenant-context is-unavailable">${t("admin.tenantUnavailable")}</span>`;
    return;
  }

  const status = enumLabel("tenantStatus", currentTenant.status);
  const role = currentTenant.currentUserRole == null ? t("admin.noTenantRole") : enumLabel("tenantUserRole", currentTenant.currentUserRole);
  const appMode = enumLabel("appMode", currentTenant.appMode);
  const canSwitch = currentTenant.allowTenantSwitching && myTenants.length > 1;

  container.innerHTML = `
    <div class="tenant-context ${currentTenant.status === 1 || currentTenant.status === "Suspended" ? "is-warning" : ""}">
      <div>
        <strong>${escapeHtml(currentTenant.displayName || currentTenant.tenantSlug || t("admin.currentTenant"))}</strong>
        <span>${escapeHtml(role)} · ${escapeHtml(status)} · ${escapeHtml(appMode)}</span>
      </div>
      ${canSwitch ? `
        <select data-tenant-switch aria-label="${t("admin.switchTenant")}">
          ${myTenants.map((tenant) => `
            <option value="${escapeHtml(tenant.id)}" ${tenant.id === currentTenant.tenantId ? "selected" : ""}>
              ${escapeHtml(tenant.displayName || tenant.name || tenant.slug)}
            </option>
          `).join("")}
        </select>
      ` : ""}
    </div>
  `;

  const switcher = qs("[data-tenant-switch]", container);
  switcher?.addEventListener("change", async (event) => {
    try {
      await TenantApi.switch(event.currentTarget.value);
      location.href = "/";
    } catch {
      event.currentTarget.value = currentTenant.tenantId;
    }
  });
}

export async function showLogin(root) {
  root.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card" aria-live="polite">
        <p class="eyebrow">AIP Portal</p>
        <h1>${t("auth.signIn")}</h1>
        ${renderLanguageSelector("language-selector auth-language")}
        <form id="login-form" class="stack">
          <label>
            <span>${t("auth.email")}</span>
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <label>
            <span>${t("auth.password")}</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <button class="primary-action" type="submit">${t("auth.loginButton")}</button>
          <p id="login-message" class="form-message" role="status"></p>
        </form>
      </section>
    </main>
  `;

  bindLanguageSelectors(root);

  qs("#login-form", root).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = qs("#login-message", root);
    message.textContent = "";

    try {
      const email = String(form.get("email") ?? "").trim();
      const password = String(form.get("password") ?? "").trim();
      await AuthApi.login(email, password);
      location.href = "/";
    } catch (error) {
      message.textContent = error?.message || t("auth.signInFailed");
    }
  });
}

export async function createShell(root) {
  const user = await AuthApi.me();
  let modules = [];
  let currentTenant = null;
  let myTenants = [];

  try {
    modules = await UiApi.modules();
  } catch {
    // TODO: Replace the static fallback once FeatureModule authorization is fully enforced by the API.
    modules = [];
  }

  try {
    currentTenant = await TenantApi.current();
    if (currentTenant.allowTenantSwitching) {
      myTenants = await TenantApi.my();
    }
  } catch {
    currentTenant = null;
    myTenants = [];
  }

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <button class="icon-button sidebar-toggle" type="button" aria-label="${t("nav.toggle")}" data-sidebar-toggle>
          <span>=</span>
        </button>
        <div class="brand-block">
          <strong>AIP Portal</strong>
          <span data-context-label>${t("nav.allWorkspaces")}</span>
        </div>
        <div data-tenant-context></div>
        <form class="search-entry" role="search" data-search-form>
          <input name="q" type="search" placeholder="${t("common.search")}" aria-label="${t("common.search")}">
        </form>
        <button class="radial-placeholder" type="button" aria-label="${t("nav.radial")}" disabled>+</button>
        <div data-notification-button></div>
        ${renderLanguageSelector()}
        <div data-user-menu></div>
      </header>
      <aside class="app-sidebar" aria-label="${t("nav.primary")}" data-sidebar></aside>
      <main id="main" class="main-content" tabindex="-1"></main>
      <aside class="app-notifications" aria-label="${t("notifications.label")}" data-notification-area></aside>
    </div>
  `;

  renderTenantContext(qs("[data-tenant-context]", root), currentTenant, myTenants);
  renderNavigation(qs("[data-sidebar]", root), modules, user, { currentTenant });
  await refreshNotifications(root);
  renderUserMenu(qs("[data-user-menu]", root), user);
  renderNotificationArea(qs("[data-notification-area]", root));
  bindLanguageSelectors(root);

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
    bindLanguageSelectors(root);
  });
  window.setInterval(() => refreshNotifications(root), 45000);

  return { user, modules, currentTenant, myTenants };
}
