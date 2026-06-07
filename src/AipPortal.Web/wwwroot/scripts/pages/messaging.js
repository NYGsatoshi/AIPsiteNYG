import { AdminApi, ConversationApi } from "../api.js";
import { badge, emptyState, errorState, escapeHtml, formatDate, loadingState, normalizeList, pageTitle, routeTo } from "../utils.js";

const ConversationType = {
  Direct: 0,
  Group: 1
};

let dmPollId = null;

function typeLabel(value) {
  if (value === ConversationType.Group || value === "Group") return "Group";
  return "Direct";
}

function conversationTitle(conversation, currentUser) {
  if (conversation.title) return conversation.title;
  const otherMember = conversation.members?.find((member) => member.userId !== currentUser?.id && !member.leftAt);
  return otherMember?.displayName || "Direct message";
}

function messagePreview(message) {
  if (!message) return "No messages yet.";
  if (message.isDeleted) return "Message deleted";
  return message.body || "Attachment";
}

function renderConversationRow(item, selectedId) {
  const active = item.id === selectedId ? "is-active" : "";
  return `
    <button class="conversation-row ${active}" type="button" data-conversation-id="${escapeHtml(item.id)}">
      <span>
        <strong>${escapeHtml(item.title || typeLabel(item.type))}</strong>
        ${badge(typeLabel(item.type), item.unreadCount > 0 ? "is-hot" : "")}
      </span>
      <span>${escapeHtml(messagePreview(item.lastMessage))}</span>
      <time>${formatDate(item.lastMessage?.createdAt || item.updatedAt || item.createdAt)}</time>
      ${item.unreadCount > 0 ? `<mark>${item.unreadCount}</mark>` : ""}
    </button>
  `;
}

function renderMessage(message, currentUser) {
  const mine = message.authorUserId === currentUser?.id ? "is-mine" : "";
  const body = message.isDeleted ? "Message deleted" : message.body;
  return `
    <article class="message-item ${mine} ${message.isDeleted ? "is-deleted" : ""}">
      <div>
        <strong>${escapeHtml(message.authorDisplayName || "Unknown")}</strong>
        <time>${formatDate(message.createdAt)}</time>
      </div>
      <p>${escapeHtml(body)}</p>
    </article>
  `;
}

async function loadAdminUsers(root, currentUser) {
  const picker = root.querySelector("[data-user-picker]");
  if (!picker) return;

  picker.innerHTML = loadingState("Loading users");
  try {
    const payload = await AdminApi.users();
    const users = normalizeList(payload).filter((user) => user.id !== currentUser?.id);
    picker.innerHTML = users.length
      ? users.map((user) => `
          <label class="checkbox-row">
            <input type="checkbox" value="${escapeHtml(user.id)}" data-user-choice>
            <span>${escapeHtml(user.displayName)} <small>${escapeHtml(user.email)}</small></span>
          </label>
        `).join("")
      : emptyState("No users available.");
  } catch (error) {
    // TODO: Replace this with a scoped user search/member picker when a non-admin API exists.
    picker.innerHTML = error.status === 403
      ? emptyState("User search is unavailable for this account.")
      : errorState(error.message);
  }
}

async function loadConversationList(root, selectedId) {
  const target = root.querySelector("[data-conversation-list]");
  target.innerHTML = loadingState("Loading conversations");

  try {
    const conversations = normalizeList(await ConversationApi.list());
    target.innerHTML = conversations.length
      ? conversations.map((item) => renderConversationRow(item, selectedId)).join("")
      : emptyState("No conversations yet.");

    target.querySelectorAll("[data-conversation-id]").forEach((button) => {
      button.addEventListener("click", () => routeTo(`/dm/${button.dataset.conversationId}`));
    });
  } catch (error) {
    target.innerHTML = errorState(error.message);
  }
}

async function markConversationRead(conversationId, messages) {
  const lastMessage = messages[0] || messages[messages.length - 1];
  try {
    await ConversationApi.markRead(conversationId, lastMessage?.id || null);
    window.dispatchEvent(new Event("aip:notifications-changed"));
  } catch {
    // Read state should never block viewing the conversation.
  }
}

async function loadConversationDetail(root, conversationId, currentUser) {
  const detail = root.querySelector("[data-conversation-detail]");
  detail.innerHTML = loadingState("Loading conversation");

  try {
    const [conversation, messagePage] = await Promise.all([
      ConversationApi.get(conversationId),
      ConversationApi.messages(conversationId, 50)
    ]);
    const messages = normalizeList(messagePage);
    await markConversationRead(conversationId, messages);
    await loadConversationList(root, conversationId);

    detail.innerHTML = `
      <div class="conversation-detail-header">
        <div>
          <h2>${escapeHtml(conversationTitle(conversation, currentUser))}</h2>
          <p>${escapeHtml(conversation.members?.filter((member) => !member.leftAt).map((member) => member.displayName || member.email).join(", ") || "No active members")}</p>
        </div>
        ${badge(typeLabel(conversation.type))}
      </div>
      <div class="message-list" data-message-list>
        ${messages.length ? messages.slice().reverse().map((message) => renderMessage(message, currentUser)).join("") : emptyState("No messages yet.")}
      </div>
      <form class="message-composer" data-message-form>
        <button class="icon-button" type="button" aria-label="Attachments unavailable" disabled>+</button>
        <textarea name="body" rows="2" placeholder="Message" aria-label="Message body"></textarea>
        <button class="primary-action compact-action" type="submit">Send</button>
        <p class="form-message" data-send-message role="status"></p>
      </form>
    `;

    const form = detail.querySelector("[data-message-form]");
    const textarea = form.elements.body;
    const messageTarget = detail.querySelector("[data-send-message]");
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = textarea.value.trim();
      messageTarget.textContent = "";
      if (!body) {
        messageTarget.textContent = "Message body is required.";
        return;
      }

      try {
        await ConversationApi.send(conversationId, body);
        textarea.value = "";
        await loadConversationDetail(root, conversationId, currentUser);
      } catch (error) {
        messageTarget.textContent = error.message;
      }
    });
  } catch (error) {
    detail.innerHTML = errorState(error.message);
  }
}

function bindCreateConversation(root, currentUser) {
  const panel = root.querySelector("[data-create-panel]");
  root.querySelector("[data-new-conversation]").addEventListener("click", async () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !panel.dataset.loaded) {
      panel.dataset.loaded = "true";
      await loadAdminUsers(root, currentUser);
    }
  });

  root.querySelector("[data-create-conversation-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = root.querySelector("[data-create-message]");
    const selected = Array.from(root.querySelectorAll("[data-user-choice]:checked")).map((input) => input.value);
    const type = form.elements.type.value;
    message.textContent = "";

    if (!selected.length) {
      message.textContent = "Select at least one user.";
      return;
    }

    if (type === "Direct" && selected.length !== 1) {
      message.textContent = "Direct conversations need one other user.";
      return;
    }

    try {
      const created = await ConversationApi.create({
        type,
        title: type === "Group" ? form.elements.title.value.trim() : null,
        memberUserIds: selected.filter((id) => id !== currentUser?.id)
      });
      routeTo(`/dm/${created.id}`);
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

export async function renderMessaging(root, shellState, conversationId) {
  if (dmPollId) {
    window.clearInterval(dmPollId);
    dmPollId = null;
  }

  root.innerHTML = `
    ${pageTitle("DM", "Recent conversations and unread messages.")}
    <section class="communications-layout">
      <aside class="conversation-panel">
        <div class="section-heading">
          <h2>Conversations</h2>
          <button class="primary-action compact-action" type="button" data-new-conversation>New</button>
        </div>
        <div class="create-panel" data-create-panel hidden>
          <form class="stack small" data-create-conversation-form>
            <label>
              <span>Type</span>
              <select name="type">
                <option value="Direct">Direct</option>
                <option value="Group">Group</option>
              </select>
            </label>
            <label>
              <span>Group title</span>
              <input name="title" type="text" maxlength="120">
            </label>
            <div class="user-picker" data-user-picker></div>
            <button class="primary-action compact-action" type="submit">Create</button>
            <p class="form-message" data-create-message role="status"></p>
          </form>
        </div>
        <div class="conversation-list" data-conversation-list>${loadingState()}</div>
      </aside>
      <section class="conversation-detail panel" data-conversation-detail>
        ${emptyState("Select a conversation.")}
      </section>
    </section>
  `;

  bindCreateConversation(root, shellState?.user);
  await loadConversationList(root, conversationId);
  if (conversationId) {
    await loadConversationDetail(root, conversationId, shellState?.user);
    dmPollId = window.setInterval(() => loadConversationDetail(root, conversationId, shellState?.user), 8000);
  }
}
