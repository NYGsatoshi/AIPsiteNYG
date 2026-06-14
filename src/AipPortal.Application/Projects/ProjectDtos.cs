using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

public sealed record ProjectListQuery(bool Archived = false, string? Search = null, ProjectStatus? Status = null, int Page = 1, int PageSize = 50)
{
    public int SafePage => Page < 1 ? 1 : Page;
    public int SafePageSize => PageSize < 1 ? 50 : Math.Min(PageSize, 100);
}

public sealed record ProjectResponse(Guid Id, Guid WorkspaceId, Guid GroupId, Guid OwnerUserId, string Title, string? Description, ProjectStatus Status, DateOnly? StartDate, DateOnly? EndDate, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt);
public sealed record CreateProjectRequest(Guid WorkspaceId, Guid GroupId, string Title, string? Description, DateOnly? StartDate, DateOnly? EndDate);
public sealed record UpdateProjectRequest(string? Title, string? Description, ProjectStatus? Status, DateOnly? StartDate, DateOnly? EndDate);
public sealed record ProjectMemberResponse(Guid UserId, string DisplayName, string Email, ProjectRole Role, DateTimeOffset JoinedAt);
public sealed record AddProjectMemberRequest(Guid UserId, ProjectRole Role);
public sealed record UpdateProjectMemberRequest(ProjectRole Role);
public sealed record ProjectChildListQuery(string? Search = null, int Page = 1, int PageSize = 50)
{
    public int SafePage => Page < 1 ? 1 : Page;
    public int SafePageSize => PageSize < 1 ? 50 : Math.Min(PageSize, 100);
}

public sealed record MilestoneResponse(Guid Id, Guid ProjectId, string Title, string? Description, DateOnly? DueDate, MilestoneStatus Status, int SortOrder, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt);
public sealed record CreateMilestoneRequest(string Title, string? Description, DateOnly? DueDate, int SortOrder);
public sealed record UpdateMilestoneRequest(string? Title, string? Description, DateOnly? DueDate, MilestoneStatus? Status, int? SortOrder);
public sealed record TaskItemResponse(Guid Id, Guid ProjectId, Guid? MilestoneId, string Title, string? Description, TaskItemStatus Status, TaskPriority Priority, DateOnly? StartDate, DateOnly? DueDate, int ProgressPercent, Guid CreatedByUserId, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt);
public sealed record CreateTaskItemRequest(Guid? MilestoneId, string Title, string? Description, TaskPriority Priority, DateOnly? StartDate, DateOnly? DueDate);
public sealed record UpdateTaskItemRequest(Guid? MilestoneId, string? Title, string? Description, TaskItemStatus? Status, TaskPriority? Priority, DateOnly? StartDate, DateOnly? DueDate, int? ProgressPercent);
public sealed record TaskAssignmentResponse(Guid Id, Guid TaskItemId, Guid UserId, string DisplayName, TaskAssignmentRole Role, decimal? EstimatedHours, decimal? ActualHours, DateTimeOffset AssignedAt, Guid AssignedByUserId);
public sealed record AddTaskAssignmentRequest(Guid UserId, TaskAssignmentRole Role, decimal? EstimatedHours);
public sealed record UpdateTaskAssignmentRequest(TaskAssignmentRole Role, decimal? EstimatedHours, decimal? ActualHours);
public sealed record TaskDependencyResponse(Guid Id, Guid PredecessorTaskId, Guid SuccessorTaskId, TaskDependencyType DependencyType, DateTimeOffset CreatedAt);
public sealed record AddTaskDependencyRequest(Guid PredecessorTaskId, TaskDependencyType DependencyType);
public sealed record CommentResponse(Guid Id, CommentTargetType TargetType, Guid TargetId, Guid AuthorUserId, string Body, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt);
public sealed record CreateCommentRequest(CommentTargetType TargetType, Guid TargetId, string Body);
public sealed record UpdateCommentRequest(string Body);
