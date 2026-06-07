import { DashboardApi } from "../api.js";
import { formatDate, normalizeList, escapeHtml, emptyState, errorState, routeTo } from "../utils.js";

export function renderNotificationButton(container, unreadCount) {
  container.innerHTML = `
    <button class="icon-button" type="button" aria-label="Notifications" data-notification-route>
      <span>!</span>
      ${unreadCount > 0 ? `<span class="badge-dot">${unreadCount}</span>` : ""}
    </button>
  `;

  container.querySelector("[data-notification-route]").addEventListener("click", () => routeTo("/notifications"));
}

export async function renderNotificationArea(container) {
  container.innerHTML = `
    <section class="notification-area" aria-label="Notifications">
      <div class="section-heading">
        <h2>Notifications</h2>
      </div>
      <div class="stack small" data-notification-list></div>
    </section>
  `;

  const list = container.querySelector("[data-notification-list]");
  try {
    const payload = await DashboardApi.notifications();
    const items = normalizeList(payload);
    list.innerHTML = items.length
      ? items.map((item) => `
          <article class="mini-item ${item.isRead ? "" : "is-unread"}">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.body || "No details")}</span>
            <time>${formatDate(item.createdAt)}</time>
          </article>
        `).join("")
      : emptyState("No unread notifications.");
  } catch (error) {
    list.innerHTML = errorState(error.message);
  }
}
