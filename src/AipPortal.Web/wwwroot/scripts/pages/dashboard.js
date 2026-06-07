import { DashboardApi } from "../api.js";
import { enumLabel } from "../enums.js";
import { emptyState, errorState, escapeHtml, formatDate, loadingState, normalizeList, pageTitle, todayIso } from "../utils.js";

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
    ${pageTitle("Dashboard", "My work, updates, and production activity.")}
    <section class="dashboard-grid">
      <article class="panel span-2">
        <div class="section-heading"><h2>My work summary</h2></div>
        <div data-my-work>${loadingState()}</div>
      </article>
      <article class="panel">
        <div class="section-heading"><h2>DM</h2></div>
        <div data-conversations>${loadingState()}</div>
      </article>
      <article class="panel">
        <div class="section-heading"><h2>Unread notifications</h2></div>
        <div data-unread>${loadingState()}</div>
      </article>
      <article class="panel">
        <div class="section-heading"><h2>Announcements</h2></div>
        <div data-announcements>${loadingState()}</div>
      </article>
      <article class="panel">
        <div class="section-heading"><h2>Upcoming events</h2></div>
        <div data-events>${loadingState()}</div>
      </article>
      <article class="panel span-2">
        <div class="section-heading"><h2>Projects</h2></div>
        <div data-projects>${loadingState()}</div>
      </article>
      <article class="panel span-2">
        <div class="section-heading"><h2>Recent artifacts or activity</h2></div>
        <div data-activity>${emptyState("No recent activity yet.")}</div>
      </article>
    </section>
  `;

  const dueBefore = todayIso(14);
  fillSection(root, "[data-my-work]", () => DashboardApi.myTasks(dueBefore), (items) => `
    <div class="metric-row">
      <div><strong>${items.length}</strong><span>tasks due soon</span></div>
      <div><strong>${items.filter((task) => task.isOverdue).length}</strong><span>overdue</span></div>
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
  `, "No assigned tasks due soon.");

  fillSection(root, "[data-conversations]", DashboardApi.conversations, (items) => `
    <div class="metric-row single">
      <div><strong>${items.reduce((sum, item) => sum + (item.unreadCount || 0), 0)}</strong><span>unread messages</span></div>
    </div>
    <div class="stack small">
      ${items.slice(0, 4).map((item) => `
        <article class="mini-item">
          <strong>${escapeHtml(item.title || "Direct message")}</strong>
          <span>${escapeHtml(item.lastMessage?.body || "No messages yet.")}</span>
        </article>
      `).join("")}
    </div>
  `, "No recent conversations.");

  fillSection(root, "[data-unread]", DashboardApi.unreadCount, (_, payload) => `
    <div class="metric-row single">
      <div><strong>${payload.unreadCount ?? 0}</strong><span>unread notifications</span></div>
    </div>
  `, "No unread notifications.");

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
  `, "No announcements yet.");

  fillSection(root, "[data-events]", () => DashboardApi.calendar(new Date().toISOString(), todayIso(30)), (items) => `
    <div class="stack small">
      ${items.slice(0, 5).map((item) => `
        <article class="mini-item">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.relatedScope?.label || "Calendar")}</span>
          <time>${formatDate(item.startsAt)}</time>
        </article>
      `).join("")}
    </div>
  `, "No upcoming events.");

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
  `, "No projects yet.");
}
