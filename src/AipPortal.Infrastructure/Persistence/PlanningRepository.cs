using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Planning;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class PlanningRepository(AppDbContext dbContext) : IPlanningRepository
{
    public async Task<ProjectGanttResponse?> GetGanttAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default)
    {
        var project = await dbContext.Projects
            .AsNoTracking()
            .Where(project => project.Id == projectId && !project.DeletedAt.HasValue)
            .Select(project => new { project.Id, project.Name, project.StartDate, project.DueDate })
            .FirstOrDefaultAsync(cancellationToken);

        if (project is null)
        {
            return null;
        }

        var milestones = await dbContext.Milestones
            .AsNoTracking()
            .Where(milestone => milestone.ProjectId == projectId && !milestone.DeletedAt.HasValue)
            .OrderBy(milestone => milestone.SortOrder)
            .Select(milestone => new GanttMilestoneResponse(milestone.Id, milestone.Name, milestone.DueDate, milestone.Status))
            .ToListAsync(cancellationToken);

        var tasks = await dbContext.TaskItems
            .AsNoTracking()
            .Where(task => task.ProjectId == projectId && !task.DeletedAt.HasValue)
            .OrderBy(task => task.SortOrder)
            .ThenBy(task => task.DueDate)
            .Select(task => new
            {
                task.Id,
                task.Title,
                task.MilestoneId,
                task.StartDate,
                task.DueDate,
                task.ProgressPercent,
                task.Status,
                task.Priority
            })
            .ToListAsync(cancellationToken);

        var taskIds = tasks.Select(task => task.Id).ToList();
        var assignees = await dbContext.TaskAssignments
            .AsNoTracking()
            .Where(assignment => taskIds.Contains(assignment.TaskItemId))
            .Select(assignment => new
            {
                assignment.TaskItemId,
                Response = new GanttAssigneeResponse(assignment.UserId, assignment.User!.DisplayName, assignment.Role)
            })
            .ToListAsync(cancellationToken);

        var assigneesByTask = assignees
            .GroupBy(assignment => assignment.TaskItemId)
            .ToDictionary(group => group.Key, group => group.Select(item => item.Response).ToList());

        var dependencies = await dbContext.TaskDependencies
            .AsNoTracking()
            .Where(dependency => dependency.ProjectId == projectId)
            .Select(dependency => new GanttDependencyResponse(dependency.Id, dependency.PredecessorTaskItemId, dependency.SuccessorTaskItemId, dependency.DependencyType))
            .ToListAsync(cancellationToken);

        return new ProjectGanttResponse(
            project.Id,
            project.Name,
            project.StartDate,
            project.DueDate,
            milestones,
            tasks.Select(task => new GanttTaskResponse(
                task.Id,
                task.Title,
                task.MilestoneId,
                task.StartDate,
                task.DueDate,
                task.ProgressPercent,
                task.Status,
                task.Priority,
                IsOverdue(task.DueDate, task.Status, today),
                assigneesByTask.GetValueOrDefault(task.Id) ?? []))
                .ToList(),
            dependencies);
    }

    public async Task<ProjectDashboardResponse?> GetDashboardAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default)
    {
        var project = await dbContext.Projects
            .AsNoTracking()
            .Where(project => project.Id == projectId && !project.DeletedAt.HasValue)
            .Select(project => new { project.Id, project.Name })
            .FirstOrDefaultAsync(cancellationToken);

        if (project is null)
        {
            return null;
        }

        var taskCounts = await dbContext.TaskItems
            .AsNoTracking()
            .Where(task => task.ProjectId == projectId && !task.DeletedAt.HasValue)
            .GroupBy(task => task.Status)
            .Select(group => new TaskStatusCountResponse(group.Key, group.Count()))
            .ToListAsync(cancellationToken);

        var taskRows = await dbContext.TaskItems
            .AsNoTracking()
            .Where(task => task.ProjectId == projectId && !task.DeletedAt.HasValue)
            .Select(task => new { task.Id, task.Title, task.DueDate, task.Status, task.Priority, ProjectTitle = project.Name })
            .ToListAsync(cancellationToken);

        var upcoming = taskRows
            .Where(task => task.DueDate.HasValue && task.DueDate.Value >= today && task.Status is not TaskItemStatus.Completed and not TaskItemStatus.Cancelled)
            .OrderBy(task => task.DueDate)
            .Take(10)
            .Select(task => new MyTaskListItemResponse(task.Id, projectId, task.ProjectTitle, task.Title, task.DueDate, task.Status, task.Priority, IsOverdue(task.DueDate, task.Status, today)))
            .ToList();

        var activity = await dbContext.ActivityLogs
            .AsNoTracking()
            .Where(log => log.ProjectId == projectId)
            .OrderByDescending(log => log.OccurredAt)
            .Take(10)
            .Select(log => new ActivityLogSummaryResponse(log.Id, log.ActivityType, log.Body, log.OccurredAt, log.AuthorUserId, log.AuthorUser!.DisplayName))
            .ToListAsync(cancellationToken);

        var comments = await dbContext.Comments
            .AsNoTracking()
            .Where(comment => !comment.DeletedAt.HasValue &&
                (comment.TargetType == CommentTargetType.Project && comment.TargetId == projectId ||
                 comment.TargetType == CommentTargetType.TaskItem && dbContext.TaskItems.Any(task => task.Id == comment.TargetId && task.ProjectId == projectId) ||
                 comment.TargetType == CommentTargetType.Artifact && dbContext.Artifacts.Any(artifact => artifact.Id == comment.TargetId && artifact.ProjectId == projectId)))
            .OrderByDescending(comment => comment.CreatedAt)
            .Take(10)
            .Select(comment => new CommentSummaryResponse(comment.Id, comment.TargetType, comment.TargetId, comment.Body, comment.CreatedAt, comment.AuthorUserId, comment.AuthorUser!.DisplayName))
            .ToListAsync(cancellationToken);

        var artifacts = await dbContext.Artifacts
            .AsNoTracking()
            .Where(artifact => artifact.ProjectId == projectId && !artifact.DeletedAt.HasValue)
            .OrderByDescending(artifact => artifact.CreatedAt)
            .Take(5)
            .Select(artifact => new DashboardArtifactResponse(artifact.Id, artifact.Name, artifact.ArtifactType, artifact.Status, artifact.CurrentVersionId, artifact.CreatedAt))
            .ToListAsync(cancellationToken);

        var members = await dbContext.ProjectMembers
            .AsNoTracking()
            .Where(member => member.ProjectId == projectId)
            .OrderBy(member => member.User!.DisplayName)
            .Select(member => new ProjectMemberSummaryResponse(member.UserId, member.User!.DisplayName, member.Role))
            .ToListAsync(cancellationToken);

        return new ProjectDashboardResponse(project.Id, project.Name, taskCounts, taskRows.Count(task => IsOverdue(task.DueDate, task.Status, today)), upcoming, activity, comments, artifacts, members);
    }

    public async Task<MyTasksProjectionPage> ListMyTasksAsync(Guid userId, MyTasksQuery query, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var source = ApplyMyTasksFilters(VisibleTasksFor(userId), userId, query, now, includeView: true);
        var page = query.SafePage;
        var pageSize = query.SafePageSize;
        var total = await source.CountAsync(cancellationToken);
        var rows = await source
            .OrderByDescending(task => task.IsBlocked)
            .ThenByDescending(task => task.Priority)
            .ThenBy(task => task.DeadlineAt ?? DateTimeOffset.MaxValue)
            .ThenBy(task => task.PlannedEndDate ?? DateOnly.MaxValue)
            .ThenByDescending(task => task.UpdatedAt ?? task.CreatedAt)
            .ThenBy(task => task.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(task => new MyTaskRow(
                task.Id,
                userId,
                task.TenantId,
                task.WorkspaceId,
                task.ProjectId,
                task.Project!.Workspace!.Name,
                task.Project.Name,
                task.Project.OwnerUserId,
                task.Kind,
                task.ParentTaskItemId,
                task.Title,
                task.WorkflowStageId,
                task.WorkflowStage == null ? null : task.WorkflowStage.Name,
                task.WorkflowStage == null ? null : task.WorkflowStage.InternalCategory,
                task.Status,
                task.Priority,
                task.IsBlocked,
                task.PlannedStartDate,
                task.PlannedEndDate,
                task.DeadlineAt,
                task.ProgressPercent,
                task.PrimaryAssigneeUserId,
                task.PrimaryAssigneeUser == null ? null : task.PrimaryAssigneeUser.DisplayName,
                task.TargetGroupId,
                task.TargetGroup == null ? null : task.TargetGroup.Name,
                task.ReviewerUserId,
                task.ReviewerUser == null ? null : task.ReviewerUser.DisplayName,
                task.CreatedByUserId,
                task.VersionNo,
                dbContext.WorkItemCollaborators.Any(collaborator => collaborator.TaskItemId == task.Id && collaborator.UserId == userId),
                dbContext.WorkItemWatchStates.Any(watch => watch.TaskItemId == task.Id && watch.UserId == userId && watch.IsWatching && !watch.IsExplicitOptOut),
                dbContext.GroupMembers.Any(member => member.GroupId == task.TargetGroupId && member.UserId == userId),
                dbContext.ProjectMembers.Any(member => member.ProjectId == task.ProjectId && member.UserId == userId && (member.Role == ProjectRole.Owner || member.Role == ProjectRole.Manager)),
                task.ChecklistItems.Count(item => item.IsCompleted),
                task.ChecklistItems.Count,
                task.ChildTaskItems.Any(),
                task.UpdatedAt ?? task.CreatedAt))
            .ToListAsync(cancellationToken);

        var taskIds = rows.Select(row => row.TaskId).ToArray();
        var labels = await dbContext.WorkItemLabels
            .AsNoTracking()
            .Where(item => taskIds.Contains(item.TaskItemId))
            .OrderBy(item => item.Label!.SortKey)
            .Select(item => new { item.TaskItemId, Label = new MyTaskLabelSummary(item.LabelId, item.Label!.Name) })
            .ToListAsync(cancellationToken);
        var labelsByTask = labels.GroupBy(item => item.TaskItemId).ToDictionary(group => group.Key, group => (IReadOnlyList<MyTaskLabelSummary>)group.Select(item => item.Label).ToList());

        var availableWorkspaceCount = await AccessibleWorkspacesFor(userId).CountAsync(cancellationToken);
        var items = rows.Select(row => ToProjection(row, labelsByTask.GetValueOrDefault(row.TaskId) ?? [], now)).ToList();
        return new MyTasksProjectionPage(items, page, pageSize, total, query.View, query.Scope, query.WorkspaceId, availableWorkspaceCount);
    }

    public async Task<MyTasksCountsResponse> GetMyTaskCountsAsync(Guid userId, MyTasksQuery query, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var visible = VisibleTasksFor(userId);
        var views = new List<MyTasksViewCount>();
        foreach (var view in Enum.GetValues<MyTasksRelationshipView>())
        {
            var count = await ApplyMyTasksFilters(visible, userId, query with { View = view, TimeGroup = null }, now, includeView: true)
                .CountAsync(cancellationToken);
            views.Add(new MyTasksViewCount(view, count));
        }

        var timeGroups = new List<MyTasksTimeGroupCount>();
        foreach (var group in Enum.GetValues<MyTasksTimeGroup>())
        {
            var count = await ApplyMyTasksFilters(visible, userId, query with { TimeGroup = group }, now, includeView: true)
                .CountAsync(cancellationToken);
            timeGroups.Add(new MyTasksTimeGroupCount(group, count));
        }

        return new MyTasksCountsResponse(
            query.Scope,
            query.WorkspaceId,
            await AccessibleWorkspacesFor(userId).CountAsync(cancellationToken),
            views,
            timeGroups);
    }

    public async Task<IReadOnlyList<Guid>> ListAccessibleWorkspaceIdsAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await AccessibleWorkspacesFor(userId).Select(workspace => workspace.Id).ToListAsync(cancellationToken);

    private IQueryable<Workspace> AccessibleWorkspacesFor(Guid userId) =>
        dbContext.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                !workspace.DeletedAt.HasValue &&
                workspace.Status == WorkspaceStatus.Active &&
                dbContext.WorkspaceMembers.Any(member =>
                    member.WorkspaceId == workspace.Id &&
                    member.UserId == userId &&
                    member.Status == MembershipStatus.Active));

    private IQueryable<TaskItem> VisibleTasksFor(Guid userId) =>
        dbContext.TaskItems
            .AsNoTracking()
            .Where(task =>
                !task.DeletedAt.HasValue &&
                !task.Project!.DeletedAt.HasValue &&
                task.Project.Status != ProjectStatus.Archived &&
                dbContext.WorkspaceMembers.Any(member =>
                    member.WorkspaceId == task.WorkspaceId &&
                    member.UserId == userId &&
                    member.Status == MembershipStatus.Active) &&
                (task.Project.OwnerUserId == userId ||
                 dbContext.ProjectMembers.Any(member => member.ProjectId == task.ProjectId && member.UserId == userId) ||
                 (!task.Project.GroupId.HasValue ||
                  dbContext.GroupMembers.Any(member => member.GroupId == task.Project.GroupId && member.UserId == userId) ||
                  dbContext.WorkspaceMembers.Any(member =>
                      member.WorkspaceId == task.WorkspaceId &&
                      member.UserId == userId &&
                      member.Status == MembershipStatus.Active &&
                       (member.Role == WorkspaceRole.Owner || member.Role == WorkspaceRole.Admin || member.Role == WorkspaceRole.Adviser)))));

    private IQueryable<TaskItem> ApplyMyTasksFilters(
        IQueryable<TaskItem> source,
        Guid userId,
        MyTasksQuery query,
        DateTimeOffset now,
        bool includeView)
    {
        if (query.Scope == MyTasksScope.CurrentWorkspace && query.WorkspaceId.HasValue)
        {
            source = source.Where(task => task.WorkspaceId == query.WorkspaceId.Value);
        }

        if (query.ProjectId.HasValue)
        {
            source = source.Where(task => task.ProjectId == query.ProjectId.Value);
        }

        if (query.StageCategory.HasValue)
        {
            source = source.Where(task => task.WorkflowStage != null && task.WorkflowStage.InternalCategory == query.StageCategory.Value);
        }

        if (query.Priority.HasValue)
        {
            source = source.Where(task => task.Priority == query.Priority.Value);
        }

        if (query.Blocked.HasValue)
        {
            source = source.Where(task => task.IsBlocked == query.Blocked.Value);
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var search = query.Search.Trim();
            source = source.Where(task => task.Title.Contains(search) || task.Project!.Name.Contains(search));
        }

        if (query.Status.HasValue)
        {
            source = source.Where(task => task.Status == query.Status.Value);
        }

        if (query.DueBefore.HasValue)
        {
            source = source.Where(task => task.PlannedEndDate.HasValue && task.PlannedEndDate.Value <= query.DueBefore.Value);
        }

        if (query.OnlyOverdue)
        {
            source = ApplyTimeGroup(source, MyTasksTimeGroup.Overdue, now);
        }

        if (includeView)
        {
            source = ApplyView(source, userId, query.View);
        }

        // The active tabs deliberately exclude completed and cancelled work. Completed is
        // relationship-aware too, rather than being an assignment-only historical list.
        if (query.View == MyTasksRelationshipView.Completed)
        {
            source = source.Where(task =>
                task.WorkflowStage == null
                    ? task.Status == TaskItemStatus.Completed
                    : task.WorkflowStage.InternalCategory == TaskStageCategory.Done);
        }
        else
        {
            source = source.Where(task =>
                task.WorkflowStage == null
                    ? task.Status != TaskItemStatus.Completed && task.Status != TaskItemStatus.Cancelled
                    : task.WorkflowStage.InternalCategory != TaskStageCategory.Done && task.WorkflowStage.InternalCategory != TaskStageCategory.Cancelled);
        }

        return query.TimeGroup.HasValue
            ? ApplyTimeGroup(source, query.TimeGroup.Value, now)
            : source;
    }

    private IQueryable<TaskItem> ApplyView(IQueryable<TaskItem> source, Guid userId, MyTasksRelationshipView view) => view switch
    {
        MyTasksRelationshipView.Assigned => source.Where(task => task.PrimaryAssigneeUserId == userId),
        MyTasksRelationshipView.Participating => source.Where(task => dbContext.WorkItemCollaborators.Any(item => item.TaskItemId == task.Id && item.UserId == userId)),
        MyTasksRelationshipView.Reviews => source.Where(task => task.ReviewerUserId == userId),
        MyTasksRelationshipView.Created => source.Where(task => task.CreatedByUserId == userId),
        MyTasksRelationshipView.Watching => source.Where(task => dbContext.WorkItemWatchStates.Any(item => item.TaskItemId == task.Id && item.UserId == userId && item.IsWatching && !item.IsExplicitOptOut)),
        MyTasksRelationshipView.TeamQueue => source.Where(task =>
            task.PrimaryAssigneeUserId == null &&
            task.TargetGroupId.HasValue &&
            dbContext.GroupMembers.Any(member => member.GroupId == task.TargetGroupId && member.UserId == userId)),
        MyTasksRelationshipView.Completed => source.Where(task =>
            task.PrimaryAssigneeUserId == userId ||
            task.CreatedByUserId == userId ||
            task.ReviewerUserId == userId ||
            dbContext.WorkItemCollaborators.Any(item => item.TaskItemId == task.Id && item.UserId == userId) ||
            dbContext.WorkItemWatchStates.Any(item => item.TaskItemId == task.Id && item.UserId == userId && item.IsWatching && !item.IsExplicitOptOut)),
        _ => source
    };

    private static IQueryable<TaskItem> ApplyTimeGroup(IQueryable<TaskItem> source, MyTasksTimeGroup group, DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var tomorrow = today.AddDays(1);
        var nextWeek = today.AddDays(8);
        var todayStart = new DateTimeOffset(today.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
        var tomorrowStart = todayStart.AddDays(1);
        var nextWeekStart = todayStart.AddDays(8);

        return group switch
        {
            MyTasksTimeGroup.Overdue => source.Where(task =>
                task.DeadlineAt.HasValue ? task.DeadlineAt.Value < now : task.PlannedEndDate.HasValue && task.PlannedEndDate.Value < today),
            MyTasksTimeGroup.Today => source.Where(task =>
                task.DeadlineAt.HasValue
                    ? task.DeadlineAt.Value >= todayStart && task.DeadlineAt.Value < tomorrowStart
                    : task.PlannedEndDate.HasValue && task.PlannedEndDate.Value == today),
            MyTasksTimeGroup.Next7Days => source.Where(task =>
                task.DeadlineAt.HasValue
                    ? task.DeadlineAt.Value >= tomorrowStart && task.DeadlineAt.Value < nextWeekStart
                    : task.PlannedEndDate.HasValue && task.PlannedEndDate.Value >= tomorrow && task.PlannedEndDate.Value < nextWeek),
            MyTasksTimeGroup.Later => source.Where(task =>
                task.DeadlineAt.HasValue
                    ? task.DeadlineAt.Value >= nextWeekStart
                    : task.PlannedEndDate.HasValue && task.PlannedEndDate.Value >= nextWeek),
            MyTasksTimeGroup.NoDeadline => source.Where(task => !task.DeadlineAt.HasValue && !task.PlannedEndDate.HasValue),
            _ => source
        };
    }

    private static MyTaskProjectionResponse ToProjection(MyTaskRow row, IReadOnlyList<MyTaskLabelSummary> labels, DateTimeOffset now)
    {
        var category = row.StageCategory ?? MapLegacyStatus(row.Status);
        var isDone = category == TaskStageCategory.Done;
        var timeGroup = ResolveTimeGroup(row.DeadlineAt, row.PlannedEndDate, now);
        var isTeamQueueEligible = row.TargetGroupId.HasValue && row.PrimaryAssigneeUserId is null && row.IsCurrentGroupMember &&
            category is TaskStageCategory.Backlog or TaskStageCategory.Todo;
        var canEdit = row.ProjectOwnerUserId == row.CurrentUserId || row.CreatedByUserId == row.CurrentUserId || row.PrimaryAssigneeUserId == row.CurrentUserId || row.IsProjectManager;
        var permissions = new MyTaskQuickEditPermissions(canEdit, canEdit, canEdit, canEdit, canEdit, canEdit, canEdit, canEdit, isTeamQueueEligible);
        return new MyTaskProjectionResponse(
            row.TaskId, row.TenantId, row.WorkspaceId, row.WorkspaceTitle, row.ProjectId, row.ProjectTitle, row.Kind, row.ParentTaskId,
            row.Title, row.WorkflowStageId, row.WorkflowStageName ?? category.ToString(), category, row.Priority, row.IsBlocked,
            row.PlannedStartDate, row.PlannedEndDate, row.DeadlineAt, row.ProgressPercent, row.HasChildren,
            row.PrimaryAssigneeUserId.HasValue ? new MyTaskPersonSummary(row.PrimaryAssigneeUserId.Value, row.PrimaryAssigneeName ?? "Unknown") : null,
            row.TargetGroupId.HasValue ? new MyTaskGroupSummary(row.TargetGroupId.Value, row.TargetGroupName ?? "Group") : null,
            row.ReviewerUserId.HasValue ? new MyTaskPersonSummary(row.ReviewerUserId.Value, row.ReviewerName ?? "Unknown") : null,
            labels, row.ChecklistCompletedCount, row.ChecklistTotalCount,
            new MyTaskRelationshipFlags(row.PrimaryAssigneeUserId == row.CurrentUserId, row.IsCollaborator, row.ReviewerUserId == row.CurrentUserId, row.CreatedByUserId == row.CurrentUserId, row.IsWatching, isTeamQueueEligible),
            timeGroup, timeGroup == MyTasksTimeGroup.Overdue && !isDone, row.Version, permissions, []);
    }

    private static TaskStageCategory MapLegacyStatus(TaskItemStatus status) => status switch
    {
        TaskItemStatus.InProgress => TaskStageCategory.InProgress,
        TaskItemStatus.WaitingReview => TaskStageCategory.Review,
        TaskItemStatus.Completed => TaskStageCategory.Done,
        TaskItemStatus.Cancelled => TaskStageCategory.Cancelled,
        _ => TaskStageCategory.Todo
    };

    private static MyTasksTimeGroup ResolveTimeGroup(DateTimeOffset? deadlineAt, DateOnly? plannedEndDate, DateTimeOffset now)
    {
        if (deadlineAt.HasValue)
        {
            var today = DateOnly.FromDateTime(now.UtcDateTime);
            if (deadlineAt.Value < now) return MyTasksTimeGroup.Overdue;
            if (deadlineAt.Value.UtcDateTime.Date == now.UtcDateTime.Date) return MyTasksTimeGroup.Today;
            return deadlineAt.Value < now.AddDays(8) ? MyTasksTimeGroup.Next7Days : MyTasksTimeGroup.Later;
        }
        if (!plannedEndDate.HasValue) return MyTasksTimeGroup.NoDeadline;
        var day = DateOnly.FromDateTime(now.UtcDateTime);
        if (plannedEndDate.Value < day) return MyTasksTimeGroup.Overdue;
        if (plannedEndDate.Value == day) return MyTasksTimeGroup.Today;
        return plannedEndDate.Value < day.AddDays(8) ? MyTasksTimeGroup.Next7Days : MyTasksTimeGroup.Later;
    }

    private sealed record MyTaskRow(
        Guid TaskId, Guid CurrentUserId, Guid TenantId, Guid WorkspaceId, Guid ProjectId, string WorkspaceTitle, string ProjectTitle, Guid ProjectOwnerUserId,
        WorkItemKind Kind, Guid? ParentTaskId, string Title, Guid? WorkflowStageId, string? WorkflowStageName, TaskStageCategory? StageCategory,
        TaskItemStatus Status, TaskPriority Priority, bool IsBlocked, DateOnly? PlannedStartDate, DateOnly? PlannedEndDate, DateTimeOffset? DeadlineAt,
        int ProgressPercent, Guid? PrimaryAssigneeUserId, string? PrimaryAssigneeName, Guid? TargetGroupId, string? TargetGroupName,
        Guid? ReviewerUserId, string? ReviewerName, Guid CreatedByUserId, long Version, bool IsCollaborator, bool IsWatching,
        bool IsCurrentGroupMember, bool IsProjectManager, int ChecklistCompletedCount, int ChecklistTotalCount, bool HasChildren, DateTimeOffset UpdatedAt);

    public async Task<ProjectWorkloadResponse?> GetWorkloadAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default)
    {
        var exists = await dbContext.Projects.AsNoTracking().AnyAsync(project => project.Id == projectId && !project.DeletedAt.HasValue, cancellationToken);
        if (!exists)
        {
            return null;
        }

        var members = await dbContext.ProjectMembers
            .AsNoTracking()
            .Where(member => member.ProjectId == projectId)
            .Select(member => new { member.UserId, member.Role, member.User!.DisplayName })
            .ToListAsync(cancellationToken);

        var assignments = await dbContext.TaskAssignments
            .AsNoTracking()
            .Where(assignment => assignment.TaskItem!.ProjectId == projectId && !assignment.TaskItem.DeletedAt.HasValue)
            .Select(assignment => new
            {
                assignment.UserId,
                assignment.EstimatedHours,
                assignment.ActualHours,
                assignment.TaskItem!.DueDate,
                assignment.TaskItem.Status
            })
            .ToListAsync(cancellationToken);

        var response = members.Select(member =>
        {
            var assigned = assignments.Where(assignment => assignment.UserId == member.UserId).ToList();
            return new ProjectMemberWorkloadResponse(
                member.UserId,
                member.DisplayName,
                member.Role,
                assigned.Count,
                assigned.Count(assignment => IsOverdue(assignment.DueDate, assignment.Status, today)),
                assigned.Sum(assignment => assignment.EstimatedHours ?? 0),
                assigned.Sum(assignment => assignment.ActualHours ?? 0));
        }).ToList();

        return new ProjectWorkloadResponse(projectId, response);
    }

    private static bool IsOverdue(DateOnly? dueDate, TaskItemStatus status, DateOnly today)
    {
        return dueDate.HasValue &&
            dueDate.Value < today &&
            status is not TaskItemStatus.Completed and not TaskItemStatus.Cancelled;
    }
}
