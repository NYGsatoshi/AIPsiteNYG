using AipPortal.Domain.Enums;
using System.Text.Json.Serialization;

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

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum MyTasksRelationshipView
{
    Assigned,
    Participating,
    Reviews,
    Created,
    Watching,
    TeamQueue,
    Completed
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum MyTasksScope
{
    CurrentWorkspace,
    AllWorkspaces
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum MyTasksTimeGroup
{
    Overdue,
    Today,
    Next7Days,
    Later,
    NoDeadline
}

/// <summary>
/// The canonical, user-relative My Tasks query. Status, dueBefore and onlyOverdue
/// are temporary compatibility aliases; callers should use stageCategory and timeGroup.
/// </summary>
public sealed record MyTasksQuery(
    MyTasksRelationshipView View = MyTasksRelationshipView.Assigned,
    MyTasksScope Scope = MyTasksScope.CurrentWorkspace,
    Guid? WorkspaceId = null,
    Guid? ProjectId = null,
    TaskStageCategory? StageCategory = null,
    TaskPriority? Priority = null,
    bool? Blocked = null,
    MyTasksTimeGroup? TimeGroup = null,
    string? Search = null,
    TaskItemStatus? Status = null,
    DateOnly? DueBefore = null,
    bool OnlyOverdue = false,
    int Page = 1,
    int PageSize = 50)
{
    public int SafePage => Page < 1 ? 1 : Page;

    public int SafePageSize => Math.Clamp(PageSize, 1, 100);
}

public sealed record MyTaskPersonSummary(Guid UserId, string DisplayName);
public sealed record MyTaskGroupSummary(Guid GroupId, string Name);
public sealed record MyTaskLabelSummary(Guid LabelId, string Name);
public sealed record MyTaskRelationshipFlags(
    bool IsPrimaryAssignee,
    bool IsCollaborator,
    bool IsReviewer,
    bool IsCreator,
    bool IsWatching,
    bool IsTeamQueueEligible);
public sealed record MyTaskQuickEditPermissions(
    bool CanChangeStage,
    bool CanUpdateProgress,
    bool CanUpdatePriority,
    bool CanUpdatePlannedEnd,
    bool CanUpdateDeadline,
    bool CanUpdateBlockedState,
    bool CanUpdateChecklist,
    bool CanUpdateLabels,
    bool CanClaim);

public sealed record MyTaskProjectionResponse(
    Guid TaskId,
    Guid TenantId,
    Guid WorkspaceId,
    string WorkspaceTitle,
    Guid ProjectId,
    string ProjectTitle,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] WorkItemKind Kind,
    Guid? ParentTaskId,
    string Title,
    Guid? WorkflowStageId,
    string WorkflowStageName,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] TaskStageCategory StageCategory,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] TaskPriority Priority,
    bool IsBlocked,
    DateOnly? PlannedStartDate,
    DateOnly? PlannedEndDate,
    DateTimeOffset? DeadlineAt,
    int ProgressPercent,
    bool ProgressIsDerived,
    MyTaskPersonSummary? PrimaryAssignee,
    MyTaskGroupSummary? TargetGroup,
    MyTaskPersonSummary? Reviewer,
    IReadOnlyList<MyTaskLabelSummary> Labels,
    int ChecklistCompletedCount,
    int ChecklistTotalCount,
    MyTaskRelationshipFlags Relationships,
    MyTasksTimeGroup TimeGroup,
    bool IsOverdue,
    long Version,
    MyTaskQuickEditPermissions QuickEditPermissions,
    IReadOnlyList<string> Warnings);

public sealed record MyTasksProjectionPage(
    IReadOnlyList<MyTaskProjectionResponse> Items,
    int Page,
    int PageSize,
    int TotalCount,
    MyTasksRelationshipView View,
    MyTasksScope Scope,
    Guid? WorkspaceId,
    int AvailableWorkspaceCount);

public sealed record MyTasksViewCount(MyTasksRelationshipView View, int Count);
public sealed record MyTasksTimeGroupCount(MyTasksTimeGroup TimeGroup, int Count);
public sealed record MyTasksCountsResponse(
    MyTasksScope Scope,
    Guid? WorkspaceId,
    int AvailableWorkspaceCount,
    IReadOnlyList<MyTasksViewCount> Views,
    IReadOnlyList<MyTasksTimeGroupCount> TimeGroups);

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
