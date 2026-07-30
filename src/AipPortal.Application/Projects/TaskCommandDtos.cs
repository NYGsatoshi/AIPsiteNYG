using AipPortal.Domain.Enums;
using AipPortal.Application.Planning;

namespace AipPortal.Application.Projects;

public sealed record TaskTransitionRequest(Guid WorkflowStageId, long ExpectedVersion, string? Reason = null);
/// <summary>Ordinary Task-body fields only. Workflow state changes use the transition command.</summary>
public sealed record TaskUpdateDetailsRequest(
    string? Title,
    string? Description,
    TaskPriority? Priority,
    DateOnly? PlannedStartDate,
    DateOnly? PlannedEndDate,
    int? ProgressPercent,
    long ExpectedVersion);
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

/// <summary>
/// Gantt scheduling owns only day-precision planned dates. MilestoneDate is
/// applicable only to the compatibility Milestone aggregate.
/// </summary>
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(
    System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record TaskScheduleUpdateRequest(
    [property: System.Text.Json.Serialization.JsonRequired] DateOnly? PlannedStartDate,
    [property: System.Text.Json.Serialization.JsonRequired] DateOnly? PlannedEndDate,
    DateOnly? MilestoneDate,
    long ExpectedVersion);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(
    System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record TaskProgressUpdateRequest(int? ProgressPercent, long ExpectedVersion);

public sealed record GanttEditCommandResponse(
    Guid TaskId,
    [property: System.Text.Json.Serialization.JsonConverter(typeof(System.Text.Json.Serialization.JsonStringEnumConverter))] WorkItemKind Kind,
    DateOnly? PlannedStartDate,
    DateOnly? PlannedEndDate,
    DateOnly? MilestoneDate,
    int ProgressPercent,
    long Version,
    IReadOnlyList<GanttWarningResponse> Warnings);

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
public sealed record TaskDetailPermissions(
    bool CanCreateSubtask,
    bool CanCreateChecklistItem,
    bool CanUpdateChecklistItems,
    bool CanDeleteChecklistItems,
    bool CanReorderChecklist,
    bool CanCreateComment,
    bool CanMarkCommentImportant,
    bool CanApplyLabels,
    bool CanManageLabelDefinitions,
    bool CanAssociateFiles,
    bool CanRemoveFiles,
    bool CanChangeWatch);

public sealed record CanonicalTaskDetailResponse(
    CanonicalTaskResponse Task,
    TaskRelationshipsResponse Relationships,
    TaskDetailPermissions Permissions,
    IReadOnlyList<TaskChecklistResponse> Checklist,
    IReadOnlyList<ProjectTaskLabelResponse> Labels,
    TaskWatchStateResponse WatchState,
    TaskSubtaskPage Subtasks,
    TaskCommentPage Comments,
    TaskFileAssociationPage Files);
