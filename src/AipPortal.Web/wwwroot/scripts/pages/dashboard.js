import { DashboardApi } from "../api.js";
import { enumLabel } from "../enums.js";
import { emptyState, errorState, escapeHtml, formatDate, loadingState, normalizeList, pageTitle, todayIso } from "../utils.js";
import { t } from "../i18n/index.js";

async function fillSection(root, selector, loader, renderer, emptyMessage) {
  const target = root.querySelector(selector);
  target.innerHTML = loadingState();

  try {
    const payload = await loader();
    const items = normalizeList(payload);
    const listPayload = Array.isArray(payload) || Array.isArray(payload?.items);
    target.innerHTML = items.length || !listPayload ? renderer(items, payload) : emptyState(emptyMessage);
  } catch (error) {
    target.innerHTML = errorState(error.message);
  }
}

export function renderDashboard(root) {
  root.innerHTML = `
    ${pageTitle(t("dashboard.title"), t("dashboard.subtitle"))}
    <section class="dashboard-grid">
      <article class="panel span-2">
        <div class="section-heading"><h2>${t("dashboard.myWork")}</h2></div>
        <div data-my-work>${loadingState()}</div>
      </article>
      <article class="panel">
        <div class="section-heading"><h2>${t("chat.title")}</h2></div>
        <div data-conversations>${loadingState()}</div>
      </article>
      <article class="panel">
        <div class="section-heading"><h2>${t("dashboard.unreadNotifications")}</h2></div>
        <div data-unread>${loadingState()}</div>
      </article>
      <article class="panel">
        <div class="section-heading"><h2>${t("announcements.title")}</h2></div>
        <div data-announcements>${loadingState()}</div>
      </article>
      <article class="panel">
        <div class="section-heading"><h2>${t("dashboard.upcomingEvents")}</h2></div>
        <div data-events>${loadingState()}</div>
      </article>
      <article class="panel span-2">
        <div class="section-heading"><h2>${t("projects.title")}</h2></div>
        <div data-projects>${loadingState()}</div>
      </article>
      <article class="panel span-2">
        <div class="section-heading"><h2>${t("dashboard.recentActivity")}</h2></div>
        <div data-activity>${emptyState(t("dashboard.noActivity"))}</div>
      </article>
    </section>
  `;

  const dueBefore = todayIso(14);
  fillSection(root, "[data-my-work]", () => DashboardApi.myTasks(dueBefore), (items) => `
    <div class="metric-row">
      <div><strong>${items.length}</strong><span>${t("dashboard.tasksDueSoon")}</span></div>
      <div><strong>${items.filter((task) => task.isOverdue).length}</strong><span>${t("dashboard.overdue")}</span></div>
    </div>
    <div class="list-table compact">
      ${items.slice(0, 5).map((task) => `
        <a href="/projects/${task.projectId}" data-route>
          <span>${escapeHtml(task.title)}</span>
          <span>${escapeHtml(task.projectTitle)}</span>
          <span>${formatDate(task.dueDate)}</span>
        </a>
      `).join("")}
    </div>
  `, t("dashboard.noTasks"));

  fillSection(root, "[data-conversations]", DashboardApi.conversations, (items) => `
    <div class="metric-row single">
      <div><strong>${items.reduce((sum, item) => sum + (item.unreadCount || 0), 0)}</strong><span>${t("dashboard.unreadMessages")}</span></div>
    </div>
    <div class="stack small">
      ${items.slice(0, 4).map((item) => `
        <article class="mini-item">
          <strong>${escapeHtml(item.title || t("chat.directMessage"))}</strong>
          <span>${escapeHtml(item.lastMessage?.body || t("chat.noMessages"))}</span>
        </article>
      `).join("")}
    </div>
  `, t("dashboard.noConversations"));

  fillSection(root, "[data-unread]", DashboardApi.unreadCount, (_, payload) => `
    <div class="metric-row single">
      <div><strong>${payload.unreadCount ?? 0}</strong><span>${t("notifications.unread")} ${t("notifications.label")}</span></div>
    </div>
  `, t("dashboard.noNotifications"));

  fillSection(root, "[data-announcements]", DashboardApi.announcements, (items) => `
    <div class="stack small">
      ${items.map((item) => `
        <article class="mini-item">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(enumLabel("announcementPriority", item.priority))}</span>
          <time>${formatDate(item.publishedAt)}</time>
        </article>
      `).join("")}
    </div>
  `, t("dashboard.noAnnouncements"));

  fillSection(root, "[data-events]", () => DashboardApi.calendar(new Date().toISOString(), todayIso(30)), (items) => `
    <div class="stack small">
      ${items.slice(0, 5).map((item) => `
        <article class="mini-item">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.relatedScope?.label || t("nav.calendar"))}</span>
          <time>${formatDate(item.startsAt)}</time>
        </article>
      `).join("")}
    </div>
  `, t("dashboard.noEvents"));

  fillSection(root, "[data-projects]", DashboardApi.projects, (items) => `
    <div class="list-table">
      ${items.slice(0, 6).map((project) => `
        <a href="/projects/${project.id}" data-route>
          <span>${escapeHtml(project.title)}</span>
          <span>${escapeHtml(enumLabel("projectStatus", project.status))}</span>
          <span>${formatDate(project.endDate)}</span>
        </a>
      `).join("")}
    </div>
  `, t("projects.empty"));
}
