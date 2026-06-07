using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Planning;
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

    public async Task<PagedResponse<MyTaskListItemResponse>> ListMyTasksAsync(Guid userId, MyTasksQuery query, DateOnly today, CancellationToken cancellationToken = default)
    {
        var source = dbContext.TaskAssignments
            .AsNoTracking()
            .Where(assignment =>
                assignment.UserId == userId &&
                !assignment.TaskItem!.DeletedAt.HasValue &&
                !assignment.TaskItem.Project!.DeletedAt.HasValue);

        if (query.Status.HasValue)
        {
            source = source.Where(assignment => assignment.TaskItem!.Status == query.Status.Value);
        }

        if (query.DueBefore.HasValue)
        {
            source = source.Where(assignment => assignment.TaskItem!.DueDate.HasValue && assignment.TaskItem.DueDate.Value <= query.DueBefore.Value);
        }

        if (query.ProjectId.HasValue)
        {
            source = source.Where(assignment => assignment.TaskItem!.ProjectId == query.ProjectId.Value);
        }

        if (query.OnlyOverdue)
        {
            source = source.Where(assignment =>
                assignment.TaskItem!.DueDate.HasValue &&
                assignment.TaskItem.DueDate.Value < today &&
                assignment.TaskItem.Status != TaskItemStatus.Completed &&
                assignment.TaskItem.Status != TaskItemStatus.Cancelled);
        }

        var page = query.SafePage;
        var pageSize = query.SafePageSize;
        var total = await source.CountAsync(cancellationToken);
        var items = await source
            .OrderBy(assignment => assignment.TaskItem!.DueDate ?? DateOnly.MaxValue)
            .ThenBy(assignment => assignment.TaskItem!.Title)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(assignment => new
            {
                assignment.TaskItem!.Id,
                assignment.TaskItem.ProjectId,
                ProjectTitle = assignment.TaskItem.Project!.Name,
                assignment.TaskItem.Title,
                assignment.TaskItem.DueDate,
                assignment.TaskItem.Status,
                assignment.TaskItem.Priority
            })
            .ToListAsync(cancellationToken);

        var responses = items
            .Select(item => new MyTaskListItemResponse(item.Id, item.ProjectId, item.ProjectTitle, item.Title, item.DueDate, item.Status, item.Priority, IsOverdue(item.DueDate, item.Status, today)))
            .ToList();

        return new PagedResponse<MyTaskListItemResponse>(responses, page, pageSize, total);
    }

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
