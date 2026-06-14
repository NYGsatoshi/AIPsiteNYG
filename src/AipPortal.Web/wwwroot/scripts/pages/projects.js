import { ProjectApi } from "../api.js";
import { CommentTargetType, TaskAssignmentRole, TaskPriority, TaskStatus, enumLabel } from "../enums.js";
import { asInt, badge, emptyState, errorState, escapeHtml, formatDate, loadingState, normalizeList, pageTitle, qs, qsa, routeTo } from "../utils.js";
import { t } from "../i18n/index.js";

const tabs = [{ key: "overview", label: "admin.overview" }, { key: "milestones", label: "projects.milestones" }, { key: "tasks", label: "nav.tasks" }, { key: "gantt", label: "projects.gantt" }, { key: "members", label: "projects.members" }, { key: "artifacts", label: "nav.files" }, { key: "activity", label: "projects.activityLogs" }, { key: "comments", label: "projects.comment" }, { key: "feedback", label: "projects.feedback" }];

export async function renderProjects(root) {
  root.innerHTML = `
    ${pageTitle(t("projects.title"), t("projects.subtitle"))}
    <section class="panel">
      <div class="toolbar">
        <label>
          <span>${t("common.status")}</span>
          <select data-filter-status>
            <option value="">${t("common.all")}</option>
            <option value="0">${enumLabel("projectStatus", 0)}</option>
            <option value="1">${enumLabel("projectStatus", 1)}</option>
            <option value="2">${enumLabel("projectStatus", 2)}</option>
            <option value="3">${enumLabel("projectStatus", 3)}</option>
          </select>
        </label>
        <label class="checkbox-row"><input type="checkbox" data-my-projects disabled> ${t("projects.myOnly")}</label>
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
              <span><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.description || t("common.noDescription"))}</small></span>
              <span>${escapeHtml(enumLabel("projectStatus", project.status))}</span>
              <span>${escapeHtml(project.groupId ? t("projects.groupLinked") : t("projects.workspace"))}</span>
              <span>${formatDate(project.startDate)}</span>
              <span>${formatDate(project.endDate)}</span>
              <span>${project.progressPercent ?? t("projects.noProgress")}</span>
            </a>
          `).join("")}
        </div>
      ` : emptyState(t("projects.empty"));
    };

    qs("[data-filter-status]", root).addEventListener("change", draw);
    draw();
  } catch (error) {
    listTarget.innerHTML = errorState(error.message);
  }
}

export async function renderProjectDetail(root, projectId) {
  root.innerHTML = `${pageTitle(t("projects.project"), t("projects.loading"))}
    <section class="panel">${loadingState()}</section>`;

  let project;
  try {
    project = await ProjectApi.get(projectId);
  } catch (error) {
    root.innerHTML = `${pageTitle(t("projects.project"), "")}<section class="panel">${errorState(error.message)}</section>`;
    return;
  }

  root.innerHTML = `
    ${pageTitle(project.title, project.description || t("projects.detail"))}
    <section class="project-summary">
      <div>${badge(enumLabel("projectStatus", project.status))}</div>
      <div><span>${t("projects.start")}</span><strong>${formatDate(project.startDate)}</strong></div>
      <div><span>${t("projects.end")}</span><strong>${formatDate(project.endDate)}</strong></div>
      <div><span>${t("projects.scope")}</span><strong>${project.groupId ? t("projects.group") : t("projects.workspace")}</strong></div>
    </section>
    <section class="panel">
      <div class="tabs" role="tablist">
        ${tabs.map((tab, index) => `<button type="button" class="${index === 0 ? "is-active" : ""}" data-tab="${tab.key}">${escapeHtml(t(tab.label))}</button>`).join("")}
      </div>
      <div data-tab-panel>${loadingState()}</div>
    </section>
  `;

  const panel = qs("[data-tab-panel]", root);
  const activate = async (name) => {
    qsa("[data-tab]", root).forEach((button) => button.classList.toggle("is-active", button.dataset.tab === name));
    panel.innerHTML = loadingState();

    if (name === "overview") await renderOverview(panel, projectId);
    if (name === "milestones") await renderMilestones(panel, projectId);
    if (name === "tasks") await renderTasks(panel, projectId);
    if (name === "gantt") await renderGantt(panel, projectId);
    if (name === "members") await renderMembers(panel, projectId);
    if (name === "artifacts") await renderArtifacts(panel, projectId);
    if (name === "activity") await renderActivityLogs(panel, projectId);
    if (name === "comments") await renderComments(panel, CommentTargetType.Project, projectId);
    if (name === "feedback") panel.innerHTML = emptyState(t("projects.feedbackUnavailable"));
  };

  qsa("[data-tab]", root).forEach((button) => {
    button.addEventListener("click", () => activate(button.dataset.tab));
  });

  await activate("overview");
}

async function renderOverview(root, projectId) {
  try {
    const dashboard = await ProjectApi.dashboard(projectId);
    root.innerHTML = `
      <div class="dashboard-grid detail-grid">
        <article class="panel-inner">
          <h3>${t("projects.taskCounts")}</h3>
          <div class="metric-row">
            ${dashboard.taskCountsByStatus.map((item) => `<div><strong>${item.count}</strong><span>${escapeHtml(enumLabel("taskStatus", item.status))}</span></div>`).join("") || "<div><strong>0</strong><span>tasks</span></div>"}
          </div>
        </article>
        <article class="panel-inner">
          <h3>${t("dashboard.overdue")}</h3>
          <div class="metric-row single"><div><strong>${dashboard.overdueTaskCount}</strong><span>tasks</span></div></div>
        </article>
        <article class="panel-inner span-2">
          <h3>${t("projects.latestActivity")}</h3>
          ${dashboard.recentActivityLogs.length ? dashboard.recentActivityLogs.map((item) => `<p>${escapeHtml(item.body)}</p>`).join("") : emptyState(t("dashboard.noActivity"))}
        </article>
        <article class="panel-inner span-2">
          <h3>${t("projects.latestArtifacts")}</h3>
          ${dashboard.latestArtifacts.length ? dashboard.latestArtifacts.map((item) => `<p>${escapeHtml(item.title)} ${badge(enumLabel("artifactStatus", item.status))}</p>`).join("") : emptyState(t("projects.noArtifacts"))}
        </article>
      </div>
    `;
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

async function renderMilestones(root, projectId) {
  try {
    const milestones = normalizeList(await ProjectApi.milestones(projectId));
    root.innerHTML = `
      <div class="toolbar"><button type="button" data-new-milestone>${t("projects.newMilestone")}</button></div>
      <div data-milestone-form></div>
      ${milestones.length ? `
        <div class="list-table compact">
          ${milestones.map((milestone) => `
            <div>
              <span><strong>${escapeHtml(milestone.title)}</strong><small>${escapeHtml(milestone.description || t("common.noDescription"))}</small></span>
              <span>${escapeHtml(enumLabel("milestoneStatus", milestone.status))}</span>
              <span>${formatDate(milestone.dueDate)}</span>
              <span>Order ${escapeHtml(String(milestone.displayOrder ?? 0))}</span>
            </div>
          `).join("")}
        </div>
      ` : emptyState(t("projects.noMilestones"))}
    `;
    qs("[data-new-milestone]", root).addEventListener("click", () => renderMilestoneForm(qs("[data-milestone-form]", root), projectId));
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

function renderMilestoneForm(root, projectId) {
  root.innerHTML = `
    <form class="inline-form" data-milestone-editor>
      <label><span>${t("common.title")}</span><input name="title" required></label>
      <label><span>${t("common.description")}</span><input name="description"></label>
      <label><span>${t("projects.dueDate")}</span><input name="dueDate" type="date"></label>
      <label><span>${t("projects.displayOrder")}</span><input name="displayOrder" type="number" value="0"></label>
      <button type="submit">${t("projects.saveMilestone")}</button>
    </form>
  `;
  qs("[data-milestone-editor]", root).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await ProjectApi.createMilestone(projectId, {
        title: form.get("title"),
        description: form.get("description") || null,
        dueDate: form.get("dueDate") || null,
        displayOrder: asInt(form.get("displayOrder"), 0)
      });
      await renderMilestones(root.parentElement, projectId);
    } catch (error) {
      root.insertAdjacentHTML("beforeend", errorState(error.message));
    }
  });
}

async function renderTasks(root, projectId) {
  try {
    const tasks = normalizeList(await ProjectApi.tasks(projectId));
    root.innerHTML = `
      <div class="section-heading">
        <h2>${t("nav.tasks")}</h2>
        <button class="primary-action compact-action" type="button" data-new-task>${t("projects.createTask")}</button>
      </div>
      <div data-task-form></div>
      <div data-task-list>
        ${tasks.length ? taskList(tasks) : emptyState(t("projects.noTasks"))}
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
          <span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.description || t("common.noDescription"))}</small></span>
          <span>${escapeHtml(enumLabel("taskStatus", task.status))}</span>
          <span>${escapeHtml(enumLabel("taskPriority", task.priority))}</span>
          <span>${formatDate(task.startDate)}</span>
          <span>${formatDate(task.dueDate)}</span>
          <span>${task.progressPercent}%</span>
          <span class="row-actions">
            <button type="button" class="text-button" data-edit-task="${task.id}">${t("common.open")}</button>
            <button type="button" class="text-button" data-task-comments="${task.id}">${t("projects.comment")}</button>
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
        <label><span>${t("common.title")}</span><input name="title" value="${escapeHtml(task?.title || "")}" required></label>
        <label><span>${t("projects.milestoneId")}</span><input name="milestoneId" value="${escapeHtml(task?.milestoneId || "")}"></label>
        <label><span>${t("projects.startDate")}</span><input name="startDate" type="date" value="${escapeHtml(task?.startDate || "")}"></label>
        <label><span>${t("projects.dueDate")}</span><input name="dueDate" type="date" value="${escapeHtml(task?.dueDate || "")}"></label>
        <label><span>${t("common.priority")}</span><select name="priority">
          ${Object.entries(TaskPriority).map(([label, value]) => `<option value="${value}" ${task?.priority === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
        <label><span>${t("common.status")}</span><select name="status">
          ${Object.entries(TaskStatus).map(([label, value]) => `<option value="${value}" ${task?.status === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
        <label><span>${t("projects.progress")}</span><input name="progressPercent" type="number" min="0" max="100" value="${task?.progressPercent ?? 0}"></label>
      </div>
      <label><span>${t("common.description")}</span><textarea name="description">${escapeHtml(task?.description || "")}</textarea></label>
      <div class="form-actions">
        <button class="primary-action compact-action" type="submit">${task ? t("projects.saveTask") : t("projects.createTask")}</button>
        <button class="text-button" type="button" data-cancel-task>${t("common.cancel")}</button>
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
      message.textContent = t("projects.titleRequired");
      return;
    }

    if (progressPercent < 0 || progressPercent > 100) {
      message.textContent = t("projects.progressInvalid");
      return;
    }

    if (startDate && dueDate && dueDate < startDate) {
      message.textContent = t("projects.dueBeforeStart");
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

    message.textContent = t("common.saved");
  });

  const assignment = qs("[data-assignment-form]", root);
  if (assignment) {
    ProjectApi.assignments(task.id)
      .then((items) => {
        const assignments = normalizeList(items);
        qs("[data-assignment-list]", root).innerHTML = assignments.length
          ? assignments.map((item) => `<div class="mini-item"><strong>${escapeHtml(item.displayName)}</strong><span>${escapeHtml(enumLabel("assignmentRole", item.role))}</span></div>`).join("")
          : emptyState(t("projects.noAssignees"));
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
      qs("[data-assignment-message]", root).textContent = t("projects.assigneeAdded");
    });
  }
}

function assignmentForm(taskId) {
  return `
    <fieldset class="assignment-box">
      <legend>${t("projects.assignments")}</legend>
      <div data-assignment-list>${loadingState()}</div>
      <div class="form-grid compact-grid" data-assignment-form>
        <label><span>${t("projects.userId")}</span><input name="userId"></label>
        <label><span>${t("projects.role")}</span><select name="role">
          ${Object.entries(TaskAssignmentRole).map(([label, value]) => `<option value="${value}">${label}</option>`).join("")}
        </select></label>
        <label><span>${t("projects.estimatedHours")}</span><input name="estimatedHours" type="number" min="0" step="0.25"></label>
        <button class="text-button" type="button" data-add-assignment>${t("common.add")}</button>
      </div>
      <p data-assignment-message class="form-message"></p>
    </fieldset>
  `;
}

async function renderGantt(root, projectId) {
  try {
    const gantt = await ProjectApi.gantt(projectId);
    if (!gantt.tasks?.length) {
      root.innerHTML = emptyState(t("projects.noGantt"));
      return;
    }

    const datedTasks = gantt.tasks.filter((task) => task.startDate && task.dueDate);
    if (!datedTasks.length) {
      root.innerHTML = emptyState(t("projects.noGantt"));
      return;
    }

    const start = new Date(Math.min(...datedTasks.map((task) => new Date(task.startDate).getTime())));
    const end = new Date(Math.max(...datedTasks.map((task) => new Date(task.dueDate).getTime())));
    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(1, Math.round((end - start) / dayMs) + 1);

    root.innerHTML = `
      <div class="gantt" style="--gantt-days:${totalDays}">
        <div class="gantt-header">
          <span>${t("projects.task")}</span>
          <span>${formatDate(start.toISOString())} - ${formatDate(end.toISOString())}</span>
        </div>
        ${datedTasks.map((task) => {
          const offset = Math.round((new Date(task.startDate) - start) / dayMs) + 1;
          const span = Math.max(1, Math.round((new Date(task.dueDate) - new Date(task.startDate)) / dayMs) + 1);
          return `
            <div class="gantt-row ${task.isOverdue ? "is-overdue" : ""}">
              <div class="gantt-label">
                <strong>${escapeHtml(task.title)}</strong>
                <span>${escapeHtml(task.assignees?.map((a) => a.displayName).join(", ") || t("projects.unassigned"))}</span>
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
    ` : emptyState(t("projects.noMembers"));
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
    ` : emptyState(t("projects.noArtifacts"));
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
    ` : emptyState(t("dashboard.noActivity"));
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}

async function renderComments(root, targetType, targetId) {
  try {
    const comments = normalizeList(await ProjectApi.comments(targetType, targetId));
    root.innerHTML = `
      <form class="comment-form" data-comment-form>
        <label><span>${t("projects.comment")}</span><textarea name="body" required></textarea></label>
        <button class="primary-action compact-action" type="submit">${t("projects.addComment")}</button>
        <p class="form-message" role="status"></p>
      </form>
      <div class="stack small">
        ${comments.length ? comments.map((comment) => `<article class="mini-item"><strong>${escapeHtml(comment.authorDisplayName || comment.authorUserId)}</strong><span>${escapeHtml(comment.body)}</span><time>${formatDate(comment.createdAt)}</time></article>`).join("") : emptyState(t("projects.noComments"))}
      </div>
    `;

    qs("[data-comment-form]", root).addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget).get("body")?.trim();
      const message = qs(".form-message", root);
      if (!body) {
        message.textContent = t("projects.commentEmpty");
        return;
      }

      await ProjectApi.addComment({ targetType, targetId, body });
      message.textContent = t("projects.commentAdded");
      await renderComments(root, targetType, targetId);
    });
  } catch (error) {
    root.innerHTML = errorState(error.message);
  }
}
