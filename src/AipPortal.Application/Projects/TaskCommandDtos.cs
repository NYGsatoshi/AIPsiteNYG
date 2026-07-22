using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

public sealed record TaskTransitionRequest(Guid WorkflowStageId, long ExpectedVersion, string? Reason = null);
public sealed record TaskBlockedStateRequest(bool IsBlocked, string? Reason, long ExpectedVersion);
public sealed record TaskRelationshipUserRequest(Guid? UserId, long ExpectedVersion);
public sealed record TaskTargetGroupRequest(Guid? GroupId, long ExpectedVersion);
public sealed record TaskCollaboratorRequest(Guid UserId, long ExpectedVersion);
public sealed record TaskReviewRequest(long ExpectedVersion, string? Reason = null, Guid? ReturnWorkflowStageId = null);
public sealed record TaskClaimRequest(long ExpectedVersion);
public sealed record TaskRestoreRequest(long ExpectedVersion);
public sealed record TaskDeleteRequest(long ExpectedVersion);
public sealed record TaskWatchStateResponse(bool IsWatching, bool IsExplicitOptOut, string[] AutomaticSources, long Version);
public sealed record TaskWatchRequest(long ExpectedVersion);

public sealed record TaskPersonSummary(Guid UserId, string DisplayName);
public sealed record TaskRelationshipsResponse(
    TaskPersonSummary? PrimaryAssignee,
    Guid? TargetGroupId,
    IReadOnlyList<TaskPersonSummary> Collaborators,
    TaskPersonSummary? Reviewer,
    long Version);

public sealed record CanonicalTaskResponse(
    Guid Id,
    Guid TenantId,
    Guid WorkspaceId,
    Guid ProjectId,
    WorkItemKind Kind,
    Guid? ParentTaskId,
    Guid? MilestoneId,
    string Title,
    string? Description,
    Guid? WorkflowStageId,
    string WorkflowStageName,
    TaskStageCategory StageCategory,
    string Priority,
    bool IsBlocked,
    string? BlockedReason,
    DateOnly? PlannedStartDate,
    DateOnly? PlannedEndDate,
    DateTimeOffset? DeadlineAt,
    DateTimeOffset? ActualStartAt,
    DateTimeOffset? CompletedAt,
    int ProgressPercent,
    bool ProgressIsDerived,
    int? EstimatedEffortMinutes,
    TaskPersonSummary? PrimaryAssignee,
    Guid? TargetGroupId,
    int CollaboratorCount,
    TaskPersonSummary? Reviewer,
    bool IsOverdue,
    IReadOnlyList<string> DependencyWarnings,
    long Version,
    TaskCommandPermissions UiPermissions,
    IReadOnlyList<TaskStageCategory> AllowedTransitions,
    TaskReviewStatus ReviewStatus,
    TaskSubresourceSummary? Subresources = null);

public sealed record TaskCommandPermissions(bool CanUpdate, bool CanAssign, bool CanDelete, bool CanReview, bool CanOverrideReview, bool CanClaim);
public sealed record TaskCommandResponse(CanonicalTaskResponse Task, IReadOnlyList<string> Warnings, bool OverrideApplied = false);
