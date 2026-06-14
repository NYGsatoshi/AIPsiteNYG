import { SystemRole } from "../enums.js";
import { escapeHtml, routeTo } from "../utils.js";
import { t } from "../i18n/index.js";

const staticNavigation = [
  { moduleKey: "dashboard", displayName: "nav.dashboard", defaultRoute: "/" },
  { moduleKey: "workspaces", displayName: "nav.workspaces", defaultRoute: "/workspaces" },
  { moduleKey: "groups", displayName: "nav.groups", defaultRoute: "/groups" },
  { moduleKey: "channels", displayName: "nav.channels", defaultRoute: "/channels" },
  { moduleKey: "direct-messages", displayName: "nav.chat", defaultRoute: "/dm" },
  { moduleKey: "announcements", displayName: "nav.announcements", defaultRoute: "/announcements" },
  { moduleKey: "projects", displayName: "nav.projects", defaultRoute: "/projects" },
  { moduleKey: "tasks", displayName: "nav.tasks", defaultRoute: "/tasks" },
  { moduleKey: "artifacts", displayName: "nav.files", defaultRoute: "/artifacts" },
  { moduleKey: "events", displayName: "nav.calendar", defaultRoute: "/calendar" },
  { moduleKey: "forms", displayName: "nav.forms", defaultRoute: "/forms" },
  { moduleKey: "tenant-admin", displayName: "nav.tenantAdmin", defaultRoute: "/tenant-admin", tenantAdminOnly: true },
  { moduleKey: "platform-admin", displayName: "nav.platformAdmin", defaultRoute: "/platform-admin", platformAdminOnly: true }
];

const routeAliases = new Map([
  ["uishell", "/"],
  ["ui-shell", "/"],
  ["messaging", "/dm"],
  ["productiontracking", "/projects"],
  ["production-tracking", "/projects"],
  ["files", "/artifacts"]
]);

function isAdmin(user) {
  return user?.systemRole === SystemRole.Admin ||
    user?.systemRole === "Admin" ||
    isPlatformAdmin(user);
}

function isPlatformAdmin(user) {
  return user?.systemRole === SystemRole.PlatformAdmin ||
    user?.systemRole === SystemRole.SystemAdmin ||
    user?.systemRole === "PlatformAdmin" ||
    user?.systemRole === "SystemAdmin";
}

function isTenantAdmin(context) {
  const role = context?.currentTenant?.currentUserRole;
  return role === "Owner" ||
    role === "Admin" ||
    role === 0 ||
    role === 1;
}

function normalizeModule(module) {
  const key = String(module.moduleKey || module.key || "").toLowerCase();
  return {
    moduleKey: key,
    displayName: module.displayName || module.name || key,
    labelKey: staticNavigation.find((item) => item.moduleKey === key)?.displayName,
    defaultRoute: module.defaultRoute || routeAliases.get(key) || `/${key}`,
    sortOrder: module.sortOrder ?? 100
  };
}

export function navigationItems(modules, user, context = {}) {
  const source = modules?.length ? modules.map(normalizeModule) : staticNavigation;
  const admin = isAdmin(user);
  const platformAdmin = isPlatformAdmin(user);
  const tenantAdmin = isTenantAdmin(context);

  const items = source
    .filter((item) => admin || item.moduleKey !== "admin")
    .filter((item) => admin || !item.adminOnly)
    .filter((item) => platformAdmin || !item.platformAdminOnly)
    .filter((item) => tenantAdmin || !item.tenantAdminOnly)
    .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100));

  if (tenantAdmin && !items.some((item) => item.moduleKey === "tenant-admin")) {
    items.push(staticNavigation.find((item) => item.moduleKey === "tenant-admin"));
  }

  if (platformAdmin && !items.some((item) => item.moduleKey === "platform-admin")) {
    items.push(staticNavigation.find((item) => item.moduleKey === "platform-admin"));
  }

  if (!items.some((item) => item.moduleKey === "dashboard")) {
    items.unshift(staticNavigation[0]);
  }

  return items.filter(Boolean);
}

export function renderNavigation(container, modules, user, context = {}) {
  const current = location.pathname;
  const items = navigationItems(modules, user, context);

  container.innerHTML = `
    <nav class="sidebar-nav" aria-label="${t("nav.primary")}">
      ${items.map((item) => {
        const active = current === item.defaultRoute || (item.defaultRoute !== "/" && current.startsWith(item.defaultRoute));
        return `
          <a href="${escapeHtml(item.defaultRoute)}" class="${active ? "is-active" : ""}" data-route>
            <span class="nav-icon">${escapeHtml((t(item.labelKey || item.displayName, {}, item.displayName)).slice(0, 1).toUpperCase())}</span>
            <span>${escapeHtml(t(item.labelKey || item.displayName, {}, item.displayName))}</span>
          </a>
        `;
      }).join("")}
    </nav>
  `;

  container.querySelectorAll("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      routeTo(link.getAttribute("href"));
    });
  });
}
