import { emptyState, pageTitle } from "../utils.js";
import { t } from "../i18n/index.js";

const titles = {
  "/workspaces": "nav.workspaces",
  "/groups": "nav.groups",
  "/channels": "nav.channels",
  "/dm": "nav.chat",
  "/announcements": "nav.announcements",
  "/tasks": "nav.tasks",
  "/artifacts": "nav.files",
  "/calendar": "nav.calendar",
  "/forms": "nav.forms",
  "/admin": "nav.admin"
};

export function renderPlaceholder(root, path) {
  const title = t(titles[path] || "common.page");
  root.innerHTML = `
    ${pageTitle(title, "")}
    <section class="panel">
      ${emptyState(t("placeholder.unimplemented", { title }))}
    </section>
  `;
}

export function renderSearch(root) {
  const query = new URLSearchParams(location.search).get("q") || "";
  root.innerHTML = `
    ${pageTitle(t("common.search"), query)}
    <section class="panel">
      ${emptyState(t("search.resultsUnavailable"))}
    </section>
  `;
}
