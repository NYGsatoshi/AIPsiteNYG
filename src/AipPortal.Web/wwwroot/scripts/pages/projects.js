import { ProjectApi } from "../api.js";
import { CommentTargetType, TaskAssignmentRole, TaskPriority, TaskStatus, enumLabel } from "../enums.js";
import { asInt, badge, emptyState, errorState, escapeHtml, formatDate, loadingState, normalizeList, pageTitle, qs, qsa, routeTo } from "../utils.js";

const tabNames = ["Overview", "Tasks", "Gantt", "Members", "Artifacts", "Activity logs", "Comments", "Feedback"];

export async function renderProjects(root) {
  root.innerHTML = `
    ${pageTitle("Projects", "Production tracking and task planning.")}
    <section class="panel">
      <div class="toolbar">
        <label>
          <span>Status</span>
          <select data-filter-status>
            <option value="">All</option>
            <option value="0">Planning</option>
            <option value="1">Active</option>
            <option value="2">Review</option>
            <option value="3">Completed</option>
          </select>
        </label>
        <label class="checkbox-row"><input type="checkbox" data-my-projects disabled> My projects only</label>
      </div>
      <div data-project-list>${loadingState()}</div>
    </section>
  `;

  const listTarget = qs("[data-project-list]", root);
  try {
    const allProjects = normalizeList(await ProjectApi.list());
    const draw = () => {
      const status = qs("[data-filter-status]", root).value;
      const projects = status ? allProjects.filter((project) => String(project.status) === status) : allProjects;
      listTarget.innerHTML = projects.length ? `
        <div class="list-table project-table">
          ${projects.map((project) => `
            <a href="/projects/${project.id}" data-route>
              <span><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.description || "No description")}</small></span>
              <span>${escapeHtml(enumLabel("projectStatus", project.status))}</span>
              <span>${escapeHtml(project.groupId ? "Group linked" : "Workspace")}</span>
              <span>${formatDate(project.startDate)}</span>
              <span>${formatDate(project.endDate)}</span>
              <span>${project.progressPercent ?? "No progress"}</span>
            </a>
          `).join("")}
        </div>
      ` : emptyState("No projects yet.");
    };

    qs("[data-filter-status]", root).addEventListener("change", draw);
    draw();
  } catch (error) {
    listTarget.innerHTML = errorState(error.message);
  }
}

export async function renderProjectDetail(root, projectId) {
  root.innerHTML = `${pageTitle("Project", "Loading project.")}
    <section class="panel">${loadingState()}</section>`;

  let project;
  try {
    project = await ProjectApi.get(projectId);
  } catch (error) {
    root.innerHTML = `${pageTitle("Project", "")}<section class="panel">${errorState(error.message)}</section>`;
    return;
  }

  root.innerHTML = `
    ${pageTitle(project.title, project.description || "Project detail")}
    <section class="project-summary">
      <div>${badge(enumLabel("projectStatus", project.status))}</div>
      <div><span>Start</span><strong>${formatDate(project.startDate)}</strong></div>
      <div><span>End</span><strong>${formatDate(project.endDate)}</strong></div>
      <div><span>Scope</span><strong>${project.groupId ? "Group" : "Workspace"}</strong></div>
    </section>
    <section class="panel">
      <div class="tabs" role="tablist">
        ${tabNames.map((name, index) => `<button type="button" class="${index === 0 ? "is-active" : ""}" data-tab="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}
      </div>
      <div data-tab-panel>${loadingState()}</div>
    </section>
  `;

  const panel = qs("[data-tab-panel]", root);
  const activate = async (name) => {
    qsa("[data-tab]", root).forEach((button) => button.classList.toggle("is-active", button.dataset.tab === name));
    panel.innerHTML = loadingState();

    if (name === "Overview") await renderOverview(panel, projectId);
    if (name === "Tasks") await renderTasks(panel, projectId);
    if (name === "Gantt") await renderGantt(panel, projectId);
    if (name === "Members") await renderMembers(panel, projectId);
    if (name === "Artifacts") await renderArtifacts(panel, projectId);
    if (name === "Activity logs") await renderActivityLogs(panel, projectId);
    if (name === "Comments") await renderComments(panel, CommentTargetType.Project, projectId);
    if (name === "Feedback") panel.innerHTML = emptyState("Feedback API is not available yet.");
  };

  qsa("[data-tab]", root).forEach((button) => {
    button.addEventListener("click", () => activate(button.dataset.tab));
  });

  await activate("Overview");
}

async function renderOverview(root, projectId) {
  try {
    const dashboard = await ProjectApi.dashboard(projectId);
    root.innerHTML = `
      <div class="dashboard-grid detail-grid">
        <article class="panel-inner">
          <h3>Task counts</h3>
          <div class="metric-row">
            ${dashboard.taskCountsByStatus.map((item) => `<div><strong>${item.count}</strong><span>${escapeHtml(enumLabel("taskStatus", item.status))}</span></div>`).join("") || "<div><strong>0</strong><span>tasks</span></div>"}
          </div>
        </article>
        <article class="panel-inner">
          <h3>Overdue</h3>
          <div class="metric-row single"><div><strong>${dashboard.overdueTaskCount}</strong><span>tasks</span></div></div>
        </article>
        <article class="panel-inner span-2">
          <h3>Latest activity</h3>
          ${dashboard.recentActivityLogs.length ? dashboard.recentActivityLogs.map((item) => `<p>${escapeHtml(item.body)}</p>`).join("") : emptyState("No recent activity yet.")}
        </article>
        <article class="panel-inner span-2">
          <h3>Latest artifacts</h3>
          ${dashboard.latestArtifacts.length ? dashboard.latestArtifacts.map((item) => `<p>${escapeHtml(item.title)} ${badge(enumLabel("artifactStatus", item.status))}</p>`).join("") : emptyState("No artifacts yet.")}
        </article>
      </div>
    `;
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

async function renderTasks(root, projectId) {
  try {
    const tasks = normalizeList(await ProjectApi.tasks(projectId));
    root.innerHTML = `
      <div class="section-heading">
        <h2>Tasks</h2>
        <button class="primary-action compact-action" type="button" data-new-task>Create task</button>
      </div>
      <div data-task-form></div>
      <div data-task-list>
        ${tasks.length ? taskList(tasks) : emptyState("No tasks yet.")}
      </div>
    `;

    qs("[data-new-task]", root).addEventListener("click", () => renderTaskForm(qs("[data-task-form]", root), projectId));
    qsa("[data-edit-task]", root).forEach((button) => {
      button.addEventListener("click", async () => renderTaskForm(qs("[data-task-form]", root), projectId, await ProjectApi.task(button.dataset.editTask)));
    });
    qsa("[data-task-comments]", root).forEach((button) => {
      button.addEventListener("click", async () => {
        const target = qs("[data-task-form]", root);
        target.innerHTML = loadingState();
        await renderComments(target, CommentTargetType.TaskItem, button.dataset.taskComments);
      });
    });
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

function taskList(tasks) {
  return `
    <div class="list-table task-table">
      ${tasks.map((task) => `
        <div>
          <span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.description || "No description")}</small></span>
          <span>${escapeHtml(enumLabel("taskStatus", task.status))}</span>
          <span>${escapeHtml(enumLabel("taskPriority", task.priority))}</span>
          <span>${formatDate(task.startDate)}</span>
          <span>${formatDate(task.dueDate)}</span>
          <span>${task.progressPercent}%</span>
          <span class="row-actions">
            <button type="button" class="text-button" data-edit-task="${task.id}">Open</button>
            <button type="button" class="text-button" data-task-comments="${task.id}">Comments</button>
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderTaskForm(root, projectId, task = null) {
  root.innerHTML = `
    <form class="task-form" data-task-form>
      <div class="form-grid">
        <label><span>Title</span><input name="title" value="${escapeHtml(task?.title || "")}" required></label>
        <label><span>Milestone ID</span><input name="milestoneId" value="${escapeHtml(task?.milestoneId || "")}"></label>
        <label><span>Start date</span><input name="startDate" type="date" value="${escapeHtml(task?.startDate || "")}"></label>
        <label><span>Due date</span><input name="dueDate" type="date" value="${escapeHtml(task?.dueDate || "")}"></label>
        <label><span>Priority</span><select name="priority">
          ${Object.entries(TaskPriority).map(([label, value]) => `<option value="${value}" ${task?.priority === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
        <label><span>Status</span><select name="status">
          ${Object.entries(TaskStatus).map(([label, value]) => `<option value="${value}" ${task?.status === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
        <label><span>Progress</span><input name="progressPercent" type="number" min="0" max="100" value="${task?.progressPercent ?? 0}"></label>
      </div>
      <label><span>Description</span><textarea name="description">${escapeHtml(task?.description || "")}</textarea></label>
      <div class="form-actions">
        <button class="primary-action compact-action" type="submit">${task ? "Save task" : "Create task"}</button>
        <button class="text-button" type="button" data-cancel-task>Cancel</button>
      </div>
      <p class="form-message" role="status"></p>
      ${task ? assignmentForm(task.id) : ""}
    </form>
  `;

  qs("[data-cancel-task]", root).addEventListener("click", () => root.innerHTML = "");
  qs("[data-task-form]", root).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startDate = form.get("startDate") || null;
    const dueDate = form.get("dueDate") || null;
    const progressPercent = asInt(form.get("progressPercent"), 0);
    const message = qs(".form-message", root);

    if (!form.get("title")?.trim()) {
      message.textContent = "Title is required.";
      return;
    }

    if (progressPercent < 0 || progressPercent > 100) {
      message.textContent = "Progress must be from 0 to 100.";
      return;
    }

    if (startDate && dueDate && dueDate < startDate) {
      message.textContent = "Due date cannot be before start date.";
      return;
    }

    const payload = {
      milestoneId: form.get("milestoneId") || null,
      title: form.get("title"),
      description: form.get("description") || null,
      priority: asInt(form.get("priority"), TaskPriority.Normal),
      startDate,
      dueDate
    };

    if (task) {
      payload.status = asInt(form.get("status"), TaskStatus.NotStarted);
      payload.progressPercent = progressPercent;
      await ProjectApi.updateTask(task.id, payload);
    } else {
      await ProjectApi.createTask(projectId, payload);
    }

    message.textContent = "Saved.";
  });

  const assignment = qs("[data-assignment-form]", root);
  if (assignment) {
    ProjectApi.assignments(task.id)
      .then((items) => {
        const assignments = normalizeList(items);
        qs("[data-assignment-list]", root).innerHTML = assignments.length
          ? assignments.map((item) => `<div class="mini-item"><strong>${escapeHtml(item.displayName)}</strong><span>${escapeHtml(enumLabel("assignmentRole", item.role))}</span></div>`).join("")
          : emptyState("No assignees yet.");
      })
      .catch((error) => {
        qs("[data-assignment-list]", root).innerHTML = errorState(error.message);
      });

    qs("[data-add-assignment]", root).addEventListener("click", async () => {
      const form = new Map(Array.from(assignment.querySelectorAll("[name]")).map((input) => [input.name, input.value]));
      await ProjectApi.addAssignment(task.id, {
        userId: form.get("userId"),
        role: asInt(form.get("role"), TaskAssignmentRole.Assignee),
        estimatedHours: form.get("estimatedHours") ? Number(form.get("estimatedHours")) : null
      });
      qs("[data-assignment-message]", root).textContent = "Assignee added.";
    });
  }
}

function assignmentForm(taskId) {
  return `
    <fieldset class="assignment-box">
      <legend>Assignments</legend>
      <div data-assignment-list>${loadingState()}</div>
      <div class="form-grid compact-grid" data-assignment-form>
        <label><span>User ID</span><input name="userId"></label>
        <label><span>Role</span><select name="role">
          ${Object.entries(TaskAssignmentRole).map(([label, value]) => `<option value="${value}">${label}</option>`).join("")}
        </select></label>
        <label><span>Estimated hours</span><input name="estimatedHours" type="number" min="0" step="0.25"></label>
        <button class="text-button" type="button" data-add-assignment>Add</button>
      </div>
      <p data-assignment-message class="form-message"></p>
    </fieldset>
  `;
}

async function renderGantt(root, projectId) {
  try {
    const gantt = await ProjectApi.gantt(projectId);
    if (!gantt.tasks?.length) {
      root.innerHTML = emptyState("No gantt dates yet.");
      return;
    }

    const datedTasks = gantt.tasks.filter((task) => task.startDate && task.dueDate);
    if (!datedTasks.length) {
      root.innerHTML = emptyState("No gantt dates yet.");
      return;
    }

    const start = new Date(Math.min(...datedTasks.map((task) => new Date(task.startDate).getTime())));
    const end = new Date(Math.max(...datedTasks.map((task) => new Date(task.dueDate).getTime())));
    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(1, Math.round((end - start) / dayMs) + 1);

    root.innerHTML = `
      <div class="gantt" style="--gantt-days:${totalDays}">
        <div class="gantt-header">
          <span>Task</span>
          <span>${formatDate(start.toISOString())} - ${formatDate(end.toISOString())}</span>
        </div>
        ${datedTasks.map((task) => {
          const offset = Math.round((new Date(task.startDate) - start) / dayMs) + 1;
          const span = Math.max(1, Math.round((new Date(task.dueDate) - new Date(task.startDate)) / dayMs) + 1);
          return `
            <div class="gantt-row ${task.isOverdue ? "is-overdue" : ""}">
              <div class="gantt-label">
                <strong>${escapeHtml(task.title)}</strong>
                <span>${escapeHtml(task.assignees?.map((a) => a.displayName).join(", ") || "Unassigned")}</span>
              </div>
              <div class="gantt-track">
                <div class="gantt-bar" style="grid-column:${offset} / span ${span}">
                  <span style="width:${task.progressPercent}%"></span>
                  <strong>${task.progressPercent}%</strong>
                </div>
              </div>
              <span class="gantt-status">${escapeHtml(enumLabel("taskStatus", task.status))}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

async function renderMembers(root, projectId) {
  try {
    const members = normalizeList(await ProjectApi.members(projectId));
    root.innerHTML = members.length ? `
      <div class="list-table compact">
        ${members.map((member) => `<div><span>${escapeHtml(member.displayName)}</span><span>${escapeHtml(member.email)}</span><span>${escapeHtml(enumLabel("projectRole", member.role))}</span></div>`).join("")}
      </div>
    ` : emptyState("No project members yet.");
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

async function renderArtifacts(root, projectId) {
  try {
    const artifacts = normalizeList(await ProjectApi.artifacts(projectId));
    root.innerHTML = artifacts.length ? `
      <div class="list-table compact">
        ${artifacts.map((artifact) => `<div><span>${escapeHtml(artifact.title)}</span><span>${escapeHtml(enumLabel("artifactType", artifact.artifactType))}</span><span>${escapeHtml(enumLabel("artifactStatus", artifact.status))}</span></div>`).join("")}
      </div>
    ` : emptyState("No artifacts yet.");
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

async function renderActivityLogs(root, projectId) {
  try {
    const dashboard = await ProjectApi.dashboard(projectId);
    root.innerHTML = dashboard.recentActivityLogs?.length ? `
      <div class="stack small">
        ${dashboard.recentActivityLogs.map((item) => `<article class="mini-item"><strong>${escapeHtml(item.authorDisplayName)}</strong><span>${escapeHtml(item.body)}</span><time>${formatDate(item.occurredAt)}</time></article>`).join("")}
      </div>
    ` : emptyState("No recent activity yet.");
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

async function renderComments(root, targetType, targetId) {
  try {
    const comments = normalizeList(await ProjectApi.comments(targetType, targetId));
    root.innerHTML = `
      <form class="comment-form" data-comment-form>
        <label><span>Comment</span><textarea name="body" required></textarea></label>
        <button class="primary-action compact-action" type="submit">Add comment</button>
        <p class="form-message" role="status"></p>
      </form>
      <div class="stack small">
        ${comments.length ? comments.map((comment) => `<article class="mini-item"><strong>${escapeHtml(comment.authorDisplayName || comment.authorUserId)}</strong><span>${escapeHtml(comment.body)}</span><time>${formatDate(comment.createdAt)}</time></article>`).join("") : emptyState("No comments yet.")}
      </div>
    `;

    qs("[data-comment-form]", root).addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget).get("body")?.trim();
      const message = qs(".form-message", root);
      if (!body) {
        message.textContent = "Comment cannot be empty.";
        return;
      }

      await ProjectApi.addComment({ targetType, targetId, body });
      message.textContent = "Comment added.";
      await renderComments(root, targetType, targetId);
    });
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}
