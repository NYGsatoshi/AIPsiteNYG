export const SystemRole = {
  NormalUser: 0,
  User: 0,
  Staff: 1,
  Teacher: 2,
  Admin: 3,
  PlatformOperator: 4,
  PlatformAdmin: 5,
  SystemAdmin: 5
};

export const TaskPriority = {
  Low: 0,
  Normal: 1,
  High: 2,
  Critical: 3
};

export const TaskStatus = {
  NotStarted: 0,
  InProgress: 1,
  WaitingReview: 2,
  Blocked: 3,
  Completed: 4,
  Cancelled: 5
};

export const TaskAssignmentRole = {
  Owner: 0,
  Assignee: 1,
  Reviewer: 2,
  Support: 3
};

export const CommentTargetType = {
  Project: 0,
  TaskItem: 1
};

export const labels = {
  projectStatus: ["Planning", "Active", "Review", "Completed", "Suspended", "Archived"],
  taskStatus: ["Not started", "In progress", "Waiting review", "Blocked", "Completed", "Cancelled"],
  taskPriority: ["Low", "Normal", "High", "Critical"],
  assignmentRole: ["Owner", "Assignee", "Reviewer", "Support"],
  projectRole: ["Owner", "Manager", "Contributor", "Reviewer", "Viewer"],
  systemRole: ["Normal user", "Staff", "Teacher", "Admin", "Platform operator", "Platform admin"],
  announcementPriority: ["Normal", "Important", "Urgent"],
  artifactType: ["Document", "Image", "Video", "Code", "Presentation", "Spreadsheet", "Archive", "Other"],
  artifactStatus: ["Draft", "Submitted", "Reviewed", "Approved", "Archived"],
  appMode: ["SaaS", "On-prem single tenant", "On-prem multi tenant"],
  tenantStatus: ["Active", "Suspended", "Archived", "Deleted"],
  tenantUserRole: ["Owner", "Admin", "Staff", "Member", "Guest"]
};

export function enumLabel(group, value) {
  if (typeof value === "string") {
    return value.replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  return labels[group]?.[value] ?? String(value ?? "");
}
