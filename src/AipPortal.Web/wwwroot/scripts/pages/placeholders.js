import { emptyState, pageTitle } from "../utils.js";

const titles = {
  "/workspaces": "Workspaces",
  "/groups": "Groups",
  "/channels": "Channels",
  "/dm": "DM",
  "/announcements": "Announcements",
  "/tasks": "Tasks",
  "/artifacts": "Artifacts",
  "/calendar": "Calendar",
  "/forms": "Forms",
  "/admin": "Admin"
};

export function renderPlaceholder(root, path) {
  const title = titles[path] || "Page";
  root.innerHTML = `
    ${pageTitle(title, "")}
    <section class="panel">
      ${emptyState(`${title} UI is not implemented in this slice.`)}
    </section>
  `;
}

export function renderSearch(root) {
  const query = new URLSearchParams(location.search).get("q") || "";
  root.innerHTML = `
    ${pageTitle("Search", query)}
    <section class="panel">
      ${emptyState("Search results UI is not implemented in this slice.")}
    </section>
  `;
}
