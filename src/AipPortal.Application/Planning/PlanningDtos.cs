using AipPortal.Domain.Enums;

namespace AipPortal.Application.Planning;

public sealed record ProjectGanttResponse(
    Guid ProjectId,
    string Title,
    DateOnly? StartDate,
    DateOnly? EndDate,
    IReadOnlyList<GanttMilestoneResponse> Milestones,
    IReadOnlyList<GanttTaskResponse> Tasks,
    IReadOnlyList<GanttDependencyResponse> Dependencies);

public sealed record GanttMilestoneResponse(Guid MilestoneId, string Title, DateOnly? DueDate, MilestoneStatus Status);

public sealed record GanttTaskResponse(
    Guid TaskId,
    string Title,
    Guid? MilestoneId,
    DateOnly? StartDate,
    DateOnly? DueDate,
    int ProgressPercent,
    TaskItemStatus Status,
    TaskPriority Priority,
    bool IsOverdue,
    IReadOnlyList<GanttAssigneeResponse> Assignees);

public sealed record GanttAssigneeResponse(Guid UserId, string DisplayName, TaskAssignmentRole Role);

public sealed record GanttDependencyResponse(Guid DependencyId, Guid PredecessorTaskId, Guid SuccessorTaskId, TaskDependencyType DependencyType);

public sealed record ProjectDashboardResponse(
    Guid ProjectId,
    string Title,
    IReadOnlyList<TaskStatusCountResponse> TaskCountsByStatus,
    int OverdueTaskCount,
    IReadOnlyList<MyTaskListItemResponse> UpcomingDueTasks,
    IReadOnlyList<ActivityLogSummaryResponse> RecentActivityLogs,
    IReadOnlyList<CommentSummaryResponse> RecentComments,
    IReadOnlyList<DashboardArtifactResponse> LatestArtifacts,
    IReadOnlyList<ProjectMemberSummaryResponse> Members);

public sealed record TaskStatusCountResponse(TaskItemStatus Status, int Count);

public sealed record ActivityLogSummaryResponse(Guid Id, ActivityLogType ActivityType, string Body, DateTimeOffset OccurredAt, Guid AuthorUserId, string AuthorDisplayName);

public sealed record CommentSummaryResponse(Guid Id, CommentTargetType TargetType, Guid TargetId, string Body, DateTimeOffset CreatedAt, Guid AuthorUserId, string AuthorDisplayName);

public sealed record DashboardArtifactResponse(Guid Id, string Title, ArtifactType ArtifactType, ArtifactStatus Status, Guid? CurrentVersionId, DateTimeOffset CreatedAt);

public sealed record ProjectMemberSummaryResponse(Guid UserId, string DisplayName, ProjectRole Role);

public sealed record MyTasksQuery(TaskItemStatus? Status, DateOnly? DueBefore, Guid? ProjectId, bool OnlyOverdue);

public sealed record MyTaskListItemResponse(
    Guid TaskId,
    Guid ProjectId,
    string ProjectTitle,
    string Title,
    DateOnly? DueDate,
    TaskItemStatus Status,
    TaskPriority Priority,
    bool IsOverdue);

public sealed record ProjectWorkloadResponse(Guid ProjectId, IReadOnlyList<ProjectMemberWorkloadResponse> Members);

public sealed record ProjectMemberWorkloadResponse(
    Guid UserId,
    string DisplayName,
    ProjectRole ProjectRole,
    int AssignedTaskCount,
    int OverdueTaskCount,
    decimal EstimatedHours,
    decimal ActualHours);
