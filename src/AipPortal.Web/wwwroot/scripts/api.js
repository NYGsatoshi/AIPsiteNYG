export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const DEFAULT_CSRF_HEADER_NAME = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
let csrfToken = null;
let csrfHeaderName = DEFAULT_CSRF_HEADER_NAME;
let csrfTokenPromise = null;

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function safeMessage(status, payload) {
  if (payload && typeof payload === "object" && typeof payload.error === "string") {
    return payload.error;
  }

  if (status === 401) return "Sign in is required.";
  if (status === 403) return "You do not have access to this workspace.";
  if (status === 404) return "The requested item was not found.";

  return "Something went wrong. Please try again.";
}

function isUnsafeMethod(method) {
  return !SAFE_METHODS.has((method || "GET").toUpperCase());
}

async function ensureCsrfToken() {
  if (csrfToken) {
    return csrfToken;
  }

  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch("/api/security/csrf-token", {
      credentials: "same-origin",
      headers: {
        accept: "application/json"
      }
    })
      .then(async (response) => {
        const payload = await parseResponse(response);
        if (!response.ok || !payload?.token) {
          throw new ApiError("A valid CSRF token could not be created.", response.status);
        }

        csrfToken = payload.token;
        csrfHeaderName = payload.headerName || DEFAULT_CSRF_HEADER_NAME;
        return csrfToken;
      })
      .finally(() => {
        csrfTokenPromise = null;
      });
  }

  return csrfTokenPromise;
}

async function refreshCsrfToken() {
  csrfToken = null;
  return ensureCsrfToken();
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = (options.method || "GET").toUpperCase();
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  if (isUnsafeMethod(method)) {
    const token = await ensureCsrfToken();
    headers.set(csrfHeaderName, token);
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    method,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    if (response.status === 403) {
      csrfToken = null;
    }

    throw new ApiError(safeMessage(response.status, payload), response.status);
  }

  return payload;
}

export const AuthApi = {
  status: () => api("/api/auth/status"),
  me: () => api("/api/auth/me"),
  login: async (email, password) => {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    await refreshCsrfToken();
    return result;
  },
  logout: async () => {
    const result = await api("/api/auth/logout", { method: "POST" });
    csrfToken = null;
    return result;
  }
};

export const UiApi = {
  modules: () => api("/api/ui/modules"),
  radialMenu: () => api("/api/ui/radial-menu?contextType=Global")
};

export const TenantApi = {
  current: () => api("/api/tenants/current"),
  my: () => api("/api/tenants/my"),
  switch: (tenantId) => api("/api/tenants/switch", {
    method: "POST",
    body: JSON.stringify({ tenantId })
  })
};

export const TenantAdminApi = {
  overview: () => api("/api/tenant/overview"),
  settings: () => api("/api/tenant/settings"),
  usage: () => api("/api/tenant/usage"),
  features: () => api("/api/tenant/features"),
  users: () => api("/api/tenant/users")
};

export const PlatformAdminApi = {
  overview: () => api("/api/platform/overview"),
  usage: () => api("/api/platform/usage"),
  tenants: () => api("/api/platform/tenants"),
  plans: () => api("/api/platform/plans")
};

export const DashboardApi = {
  notifications: () => api("/api/notifications?page=1&pageSize=5"),
  unreadCount: () => api("/api/notifications/unread-count"),
  announcements: () => api("/api/announcements?page=1&pageSize=5"),
  myTasks: (dueBefore) => api(`/api/me/tasks?dueBefore=${encodeURIComponent(dueBefore)}`),
  projects: () => api("/api/projects"),
  conversations: () => api("/api/conversations"),
  calendar: (fromDate, toDate) => api(`/api/calendar?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`)
};

export const ConversationApi = {
  list: () => api("/api/conversations"),
  get: (conversationId) => api(`/api/conversations/${conversationId}`),
  messages: (conversationId, limit = 50) => api(`/api/conversations/${conversationId}/messages?limit=${encodeURIComponent(limit)}`),
  create: (payload) => api("/api/conversations", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  send: (conversationId, body) => api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body })
  }),
  markRead: (conversationId, lastReadMessageId) => api(`/api/conversations/${conversationId}/read`, {
    method: "POST",
    body: JSON.stringify({ lastReadMessageId })
  })
};

export const NotificationApi = {
  list: (page = 1, pageSize = 30) => api(`/api/notifications?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`),
  unreadCount: () => api("/api/notifications/unread-count"),
  markRead: (notificationId) => api(`/api/notifications/${notificationId}/read`, { method: "PATCH" }),
  markAllRead: () => api("/api/notifications/read-all", { method: "PATCH" })
};

export const AnnouncementApi = {
  list: (page = 1, pageSize = 30) => api(`/api/announcements?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`),
  get: (announcementId) => api(`/api/announcements/${announcementId}`),
  create: (payload) => api("/api/announcements", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  update: (announcementId, payload) => api(`/api/announcements/${announcementId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }),
  markRead: (announcementId) => api(`/api/announcements/${announcementId}/read`, { method: "POST" }),
  readStatus: (announcementId) => api(`/api/announcements/${announcementId}/read-status`),
  resendUnread: (announcementId) => api(`/api/announcements/${announcementId}/resend-unread`, { method: "POST" })
};

export const AdminApi = {
  users: () => api("/api/admin/users?page=1&pageSize=50")
};

export const ProjectApi = {
  list: () => api("/api/projects"),
  get: (projectId) => api(`/api/projects/${projectId}`),
  dashboard: (projectId) => api(`/api/projects/${projectId}/dashboard`),
  tasks: (projectId) => api(`/api/projects/${projectId}/tasks`),
  createTask: (projectId, payload) => api(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  updateTask: (taskId, payload) => api(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }),
  task: (taskId) => api(`/api/tasks/${taskId}`),
  assignments: (taskId) => api(`/api/tasks/${taskId}/assignments`),
  addAssignment: (taskId, payload) => api(`/api/tasks/${taskId}/assignments`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  comments: (targetType, targetId) => api(`/api/comments?targetType=${targetType}&targetId=${targetId}`),
  addComment: (payload) => api("/api/comments", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  gantt: (projectId) => api(`/api/projects/${projectId}/gantt`),
  members: (projectId) => api(`/api/projects/${projectId}/members`),
  artifacts: (projectId) => api(`/api/projects/${projectId}/artifacts`)
};
