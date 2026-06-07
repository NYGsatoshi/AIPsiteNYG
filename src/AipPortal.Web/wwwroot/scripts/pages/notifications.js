import { NotificationApi } from "../api.js";
import { emptyState, errorState, escapeHtml, formatDate, loadingState, normalizeList, pageTitle, routeTo } from "../utils.js";

function renderNotification(item) {
  const linkedTitle = item.targetRoute
    ? `<a href="${escapeHtml(item.targetRoute)}" data-target-route>${escapeHtml(item.title)}</a>`
    : escapeHtml(item.title);

  return `
    <article class="notification-card ${item.isRead ? "" : "is-unread"}" data-notification-id="${escapeHtml(item.id)}">
      <div>
        <strong>${linkedTitle}</strong>
        <time>${formatDate(item.createdAt)}</time>
      </div>
      <p>${escapeHtml(item.body || "No details")}</p>
      <div class="row-actions">
        ${item.relatedEntityType ? `<small>${escapeHtml(item.relatedEntityType)}</small>` : ""}
        ${item.isRead ? "" : `<button class="text-button" type="button" data-mark-read>Mark read</button>`}
      </div>
    </article>
  `;
}

async function refreshNotifications(root) {
  const list = root.querySelector("[data-notification-list]");
  list.innerHTML = loadingState("Loading notifications");

  try {
    const payload = await NotificationApi.list();
    const items = normalizeList(payload);
    const unread = await NotificationApi.unreadCount();
    root.querySelector("[data-unread-total]").textContent = String(unread.unreadCount ?? 0);

    list.innerHTML = items.length
      ? items.map(renderNotification).join("")
      : emptyState("No notifications.");

    list.querySelectorAll("[data-mark-read]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest("[data-notification-id]");
        await NotificationApi.markRead(card.dataset.notificationId);
        window.dispatchEvent(new Event("aip:notifications-changed"));
        await refreshNotifications(root);
      });
    });

    list.querySelectorAll("[data-target-route]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        routeTo(link.getAttribute("href"));
      });
    });
  } catch (error) {
    list.innerHTML = errorState(error.message);
  }
}

export async function renderNotifications(root) {
  root.innerHTML = `
    ${pageTitle("Notifications", "Unread updates and related activity.")}
    <section class="panel notification-page">
      <div class="section-heading">
        <h2><span data-unread-total>0</span> unread</h2>
        <button class="primary-action compact-action" type="button" data-mark-all>Mark all read</button>
      </div>
      <div class="stack" data-notification-list>${loadingState()}</div>
    </section>
  `;

  root.querySelector("[data-mark-all]").addEventListener("click", async () => {
    try {
      await NotificationApi.markAllRead();
      window.dispatchEvent(new Event("aip:notifications-changed"));
      await refreshNotifications(root);
    } catch (error) {
      root.querySelector("[data-notification-list]").innerHTML = errorState(error.message);
    }
  });

  await refreshNotifications(root);
}
