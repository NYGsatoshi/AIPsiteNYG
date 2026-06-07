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
  { moduleKey: "admin", displayName: "Admin", defaultRoute: "/admin", adminOnly: true }
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
    user?.systemRole === SystemRole.SystemAdmin ||
    user?.systemRole === "Admin" ||
    user?.systemRole === "SystemAdmin";
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

export function navigationItems(modules, user) {
  const source = modules?.length ? modules.map(normalizeModule) : staticNavigation;
  const admin = isAdmin(user);

  const items = source
    .filter((item) => admin || item.moduleKey !== "admin")
    .filter((item) => admin || !item.adminOnly)
    .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100));

  if (!items.some((item) => item.moduleKey === "dashboard")) {
    items.unshift(staticNavigation[0]);
  }

  return items;
}

export function renderNavigation(container, modules, user) {
  const current = location.pathname;
  const items = navigationItems(modules, user);

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
