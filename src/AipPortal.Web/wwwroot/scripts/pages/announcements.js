import { AnnouncementApi } from "../api.js";
import { enumLabel } from "../enums.js";
import { badge, emptyState, errorState, escapeHtml, formatDate, loadingState, normalizeList, pageTitle, routeTo } from "../utils.js";

function canCreateAnnouncement(user) {
  return ["Teacher", "Admin", "SystemAdmin"].includes(user?.systemRole) || [2, 3, 4].includes(user?.systemRole);
}

function priorityBadge(item) {
  if (item.isPinned) return badge("Pinned", "is-hot");
  if (item.priority === "Urgent" || item.priority === 2) return badge("Urgent", "is-hot");
  if (item.priority === "Important" || item.priority === 1) return badge("Important");
  return "";
}

function renderAnnouncementRow(item, selectedId) {
  return `
    <button class="announcement-row ${item.id === selectedId ? "is-active" : ""} ${item.isRead ? "" : "is-unread"}" type="button" data-announcement-id="${escapeHtml(item.id)}">
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        ${priorityBadge(item)}
      </span>
      <span>${escapeHtml(enumLabel("announcementPriority", item.priority))}</span>
      <time>${formatDate(item.publishedAt)}</time>
      ${item.requiresReadConfirmation && !item.isRead ? "<mark>Read required</mark>" : ""}
    </button>
  `;
}

async function loadAnnouncementList(root, selectedId) {
  const target = root.querySelector("[data-announcement-list]");
  target.innerHTML = loadingState("Loading announcements");

  try {
    const items = normalizeList(await AnnouncementApi.list());
    target.innerHTML = items.length
      ? items.map((item) => renderAnnouncementRow(item, selectedId)).join("")
      : emptyState("No announcements.");

    target.querySelectorAll("[data-announcement-id]").forEach((button) => {
      button.addEventListener("click", () => routeTo(`/announcements/${button.dataset.announcementId}`));
    });
  } catch (error) {
    target.innerHTML = errorState(error.message);
  }
}

function announcementFormMarkup(announcement = null) {
  return `
    <form class="task-form" data-announcement-form>
      <div class="form-grid">
        <label>
          <span>Title</span>
          <input name="title" type="text" value="${escapeHtml(announcement?.title || "")}" required maxlength="160">
        </label>
        <label>
          <span>Priority</span>
          <select name="priority">
            ${["Normal", "Important", "Urgent"].map((priority) => `
              <option value="${priority}" ${enumLabel("announcementPriority", announcement?.priority) === priority ? "selected" : ""}>${priority}</option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>Scope ID</span>
          <input name="scopeId" type="text" value="${escapeHtml(announcement?.channelId || announcement?.groupId || announcement?.workspaceId || "")}">
        </label>
      </div>
      <label>
        <span>Body</span>
        <textarea name="body" required>${escapeHtml(announcement?.body || "")}</textarea>
      </label>
      <div class="form-actions">
        <label class="checkbox-row">
          <input name="isPinned" type="checkbox" ${announcement?.isPinned ? "checked" : ""}>
          <span>Pinned</span>
        </label>
        <label class="checkbox-row">
          <input name="requiresReadConfirmation" type="checkbox" ${announcement?.requiresReadConfirmation ? "checked" : ""}>
          <span>Read confirmation</span>
        </label>
        <select name="scopeType" aria-label="Scope type">
          <option value="global">Global</option>
          <option value="workspace" ${announcement?.workspaceId && !announcement?.groupId && !announcement?.channelId ? "selected" : ""}>Workspace</option>
          <option value="group" ${announcement?.groupId && !announcement?.channelId ? "selected" : ""}>Group</option>
          <option value="channel" ${announcement?.channelId ? "selected" : ""}>Channel</option>
        </select>
        <button class="primary-action compact-action" type="submit">${announcement ? "Save" : "Create"}</button>
      </div>
      <p class="form-message" data-announcement-message role="status"></p>
    </form>
  `;
}

function readFormPayload(form) {
  const data = new FormData(form);
  const scopeType = data.get("scopeType");
  const scopeId = String(data.get("scopeId") || "").trim();
  const payload = {
    title: String(data.get("title") || "").trim(),
    body: String(data.get("body") || "").trim(),
    priority: data.get("priority"),
    isPinned: data.get("isPinned") === "on",
    requiresReadConfirmation: data.get("requiresReadConfirmation") === "on"
  };

  if (scopeType === "workspace" && scopeId) payload.workspaceId = scopeId;
  if (scopeType === "group" && scopeId) payload.groupId = scopeId;
  if (scopeType === "channel" && scopeId) payload.channelId = scopeId;
  return payload;
}

async function loadReadStatus(root, announcementId) {
  const target = root.querySelector("[data-read-status]");
  if (!target) return;

  try {
    const status = await AnnouncementApi.readStatus(announcementId);
    target.innerHTML = `
      <div class="metric-row">
        <div><strong>${status.readCount}</strong><span>read</span></div>
        <div><strong>${status.unreadCount}</strong><span>unread</span></div>
      </div>
      ${status.unreadUsers?.length ? `
        <div class="stack small">
          ${status.unreadUsers.slice(0, 8).map((user) => `
            <article class="mini-item">
              <strong>${escapeHtml(user.displayName)}</strong>
              <span>${escapeHtml(user.email)}</span>
            </article>
          `).join("")}
        </div>
        <button class="text-button" type="button" data-resend-unread>Resend unread</button>
      ` : emptyState("No unread recipients.")}
    `;

    target.querySelector("[data-resend-unread]")?.addEventListener("click", async () => {
      await AnnouncementApi.resendUnread(announcementId);
      await loadReadStatus(root, announcementId);
    });
  } catch {
    target.innerHTML = "";
  }
}

async function loadAnnouncementDetail(root, shellState, announcementId) {
  const detail = root.querySelector("[data-announcement-detail]");
  detail.innerHTML = loadingState("Loading announcement");

  try {
    const announcement = await AnnouncementApi.get(announcementId);
    const canEdit = canCreateAnnouncement(shellState?.user) || announcement.authorUserId === shellState?.user?.id;

    detail.innerHTML = `
      <article class="announcement-detail">
        <div class="conversation-detail-header">
          <div>
            <h2>${escapeHtml(announcement.title)}</h2>
            <p>${formatDate(announcement.publishedAt)}${announcement.expiresAt ? ` &middot; Expires ${formatDate(announcement.expiresAt)}` : ""}</p>
          </div>
          <div class="row-actions">
            ${priorityBadge(announcement)}
            ${announcement.requiresReadConfirmation ? badge(announcement.isRead ? "Confirmed" : "Read required", announcement.isRead ? "" : "is-hot") : ""}
          </div>
        </div>
        <div class="prose">${escapeHtml(announcement.body).replaceAll("\n", "<br>")}</div>
        <div class="row-actions">
          ${announcement.requiresReadConfirmation && !announcement.isRead ? `<button class="primary-action compact-action" type="button" data-mark-announcement-read>Confirm read</button>` : ""}
          ${canEdit ? `<button class="text-button" type="button" data-toggle-edit>Edit</button>` : ""}
        </div>
        <div data-edit-panel hidden>${announcementFormMarkup(announcement)}</div>
        <div class="read-status" data-read-status></div>
      </article>
    `;

    detail.querySelector("[data-mark-announcement-read]")?.addEventListener("click", async () => {
      await AnnouncementApi.markRead(announcementId);
      await loadAnnouncementList(root, announcementId);
      await loadAnnouncementDetail(root, shellState, announcementId);
    });

    detail.querySelector("[data-toggle-edit]")?.addEventListener("click", () => {
      const panel = detail.querySelector("[data-edit-panel]");
      panel.hidden = !panel.hidden;
    });

    detail.querySelector("[data-announcement-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = detail.querySelector("[data-announcement-message]");
      message.textContent = "";
      try {
        await AnnouncementApi.update(announcementId, readFormPayload(event.currentTarget));
        await loadAnnouncementList(root, announcementId);
        await loadAnnouncementDetail(root, shellState, announcementId);
      } catch (error) {
        message.textContent = error.message;
      }
    });

    await loadReadStatus(root, announcementId);
  } catch (error) {
    detail.innerHTML = errorState(error.message);
  }
}

function bindCreate(root, shellState) {
  if (!canCreateAnnouncement(shellState?.user)) return;

  const panel = root.querySelector("[data-create-announcement]");
  root.querySelector("[data-new-announcement]").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  panel.querySelector("[data-announcement-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = panel.querySelector("[data-announcement-message]");
    message.textContent = "";
    try {
      const created = await AnnouncementApi.create(readFormPayload(event.currentTarget));
      routeTo(`/announcements/${created.id}`);
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

export async function renderAnnouncements(root, shellState, announcementId) {
  root.innerHTML = `
    ${pageTitle("Announcements", "Pinned notices, important updates, and read confirmations.")}
    <section class="communications-layout">
      <aside class="conversation-panel">
        <div class="section-heading">
          <h2>Announcements</h2>
          ${canCreateAnnouncement(shellState?.user) ? `<button class="primary-action compact-action" type="button" data-new-announcement>New</button>` : ""}
        </div>
        ${canCreateAnnouncement(shellState?.user) ? `<div class="create-panel" data-create-announcement hidden>${announcementFormMarkup()}</div>` : ""}
        <div class="announcement-list" data-announcement-list>${loadingState()}</div>
      </aside>
      <section class="conversation-detail panel" data-announcement-detail>
        ${emptyState("Select an announcement.")}
      </section>
    </section>
  `;

  bindCreate(root, shellState);
  await loadAnnouncementList(root, announcementId);
  if (announcementId) {
    await loadAnnouncementDetail(root, shellState, announcementId);
  }
}
