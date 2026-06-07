export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function safeMessage(status, payload) {
  if (status === 401) return "Sign in is required.";
  if (status === 403) return "You do not have access to this workspace.";
  if (status === 404) return "The requested item was not found.";
  if (payload && typeof payload === "object" && typeof payload.error === "string") {
    return payload.error;
  }

  return "Something went wrong. Please try again.";
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    throw new ApiError(safeMessage(response.status, payload), response.status);
  }

  return payload;
}

export const AuthApi = {
  me: () => api("/api/auth/me"),
  login: (email, password) => api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  }),
  logout: () => api("/api/auth/logout", { method: "POST" })
};

export const UiApi = {
  modules: () => api("/api/ui/modules"),
  radialMenu: () => api("/api/ui/radial-menu?contextType=Global")
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
