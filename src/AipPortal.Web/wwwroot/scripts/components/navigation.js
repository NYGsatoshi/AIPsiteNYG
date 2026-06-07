import { SystemRole } from "../enums.js";
import { escapeHtml, routeTo } from "../utils.js";

const staticNavigation = [
  { moduleKey: "dashboard", displayName: "Dashboard", defaultRoute: "/" },
  { moduleKey: "workspaces", displayName: "Workspaces", defaultRoute: "/workspaces" },
  { moduleKey: "groups", displayName: "Groups", defaultRoute: "/groups" },
  { moduleKey: "channels", displayName: "Channels", defaultRoute: "/channels" },
  { moduleKey: "direct-messages", displayName: "DM", defaultRoute: "/dm" },
  { moduleKey: "announcements", displayName: "Announcements", defaultRoute: "/announcements" },
  { moduleKey: "projects", displayName: "Projects", defaultRoute: "/projects" },
  { moduleKey: "tasks", displayName: "Tasks", defaultRoute: "/tasks" },
  { moduleKey: "artifacts", displayName: "Artifacts", defaultRoute: "/artifacts" },
  { moduleKey: "events", displayName: "Calendar", defaultRoute: "/calendar" },
  { moduleKey: "forms", displayName: "Forms", defaultRoute: "/forms" },
  { moduleKey: "tenant-admin", displayName: "Tenant Admin", defaultRoute: "/tenant-admin", tenantAdminOnly: true },
  { moduleKey: "platform-admin", displayName: "Platform Admin", defaultRoute: "/platform-admin", platformAdminOnly: true }
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
    <nav class="sidebar-nav" aria-label="Primary">
      ${items.map((item) => {
        const active = current === item.defaultRoute || (item.defaultRoute !== "/" && current.startsWith(item.defaultRoute));
        return `
          <a href="${escapeHtml(item.defaultRoute)}" class="${active ? "is-active" : ""}" data-route>
            <span class="nav-icon">${escapeHtml(item.displayName.slice(0, 1).toUpperCase())}</span>
            <span>${escapeHtml(item.displayName)}</span>
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
