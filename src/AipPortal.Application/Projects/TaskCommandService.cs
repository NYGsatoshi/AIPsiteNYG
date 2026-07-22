using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

/// <summary>Authoritative, versioned Task command boundary. Controllers and legacy adapters must not mutate TaskItem fields directly.</summary>
public sealed class TaskCommandService(
    IProjectRepository projects,
    IGroupRepository groups,
    IUserRepository users,
    IProjectAuthorizationService projectAuthorization,
    ITaskAuthorizationService taskAuthorization,
    ICurrentUser currentUser,
    IClock clock,
    IAuditLogger audit,
    IBusinessInvalidationPublisher invalidations,
    IUnitOfWork unitOfWork) : ITaskCommandService
{
    public async Task<Result<CanonicalTaskResponse>> GetAsync(Guid taskId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskId, cancellationToken);
        if (!TryActor(out var actor) || task is null || task.DeletedAt.HasValue || !await projectAuthorization.CanViewProject(actor, task.ProjectId, cancellationToken))
            return Fail<CanonicalTaskResponse>("TASK_NOT_FOUND", "Task not found.");
        return Result<CanonicalTaskResponse>.Success(await ToResponseAsync(task, actor, cancellationToken));
    }

    public async Task<Result<TaskRelationshipsResponse>> GetRelationshipsAsync(Guid taskId, CancellationToken cancellationToken = default)
    {
        var task = await AuthorizedTaskAsync(taskId, false, cancellationToken: cancellationToken);
        if (task.Error is not null) return Fail<TaskRelationshipsResponse>(task.Error.Value.Code, task.Error.Value.Message);
        var value = task.Value!;
        return Result<TaskRelationshipsResponse>.Success(await RelationshipsAsync(value, cancellationToken));
    }

    public async Task<Result<TaskCommandResponse>> TransitionAsync(Guid taskId, TaskTransitionRequest request, CancellationToken cancellationToken = default)
    {
        var taskResult = await AuthorizedTaskAsync(taskId, true, cancellationToken: cancellationToken);
        if (taskResult.Error is not null) return Fail<TaskCommandResponse>(taskResult.Error.Value.Code, taskResult.Error.Value.Message);
        var task = taskResult.Value!;
        var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        var stage = await projects.GetWorkflowStageAsync(request.WorkflowStageId, cancellationToken);
        if (stage is null || stage.ProjectId != task.ProjectId) return Fail<TaskCommandResponse>("TASK_INVALID_STAGE", "Workflow stage is not available for this task.");
        if (stage.InternalCategory == TaskStageCategory.InProgress && !task.PrimaryAssigneeUserId.HasValue) return Fail<TaskCommandResponse>("TASK_ASSIGNEE_REQUIRED", "A primary assignee is required before active work.");
        if (stage.InternalCategory == TaskStageCategory.Done && await ReviewRequiredAsync(task, cancellationToken)) return Fail<TaskCommandResponse>("TASK_REVIEW_REQUIRED", "An accepted review is required before completion.");
        if (stage.InternalCategory == TaskStageCategory.Cancelled && !IsBounded(request.Reason)) return Fail<TaskCommandResponse>("TASK_CANCEL_REASON_REQUIRED", "A cancellation reason is required.");
        if (stage.InternalCategory == TaskStageCategory.Done && (await projects.ListTasksAsync(task.ProjectId, cancellationToken)).Any(child => child.ParentTaskItemId == task.Id && !child.DeletedAt.HasValue && CategoryOf(child) != TaskStageCategory.Done && CategoryOf(child) != TaskStageCategory.Cancelled)) return Fail<TaskCommandResponse>("TASK_TRANSITION_GUARD_FAILED", "A parent task with incomplete children cannot be completed.");

        var previous = CategoryOf(task);
        task.WorkflowStageId = stage.Id;
        task.Status = LegacyStatus(stage.InternalCategory);
        var now = clock.UtcNow;
        if (stage.InternalCategory is TaskStageCategory.InProgress or TaskStageCategory.Review && !task.ActualStartAt.HasValue) task.ActualStartAt = now;
        if (stage.InternalCategory == TaskStageCategory.Done) { task.ProgressPercent = 100; task.CompletedAt = now; task.CancelledAt = null; task.CancellationReason = null; }
        if (previous == TaskStageCategory.Done && stage.InternalCategory != TaskStageCategory.Done) task.CompletedAt = null;
        if (stage.InternalCategory == TaskStageCategory.Cancelled) { task.CancelledAt = now; task.CancellationReason = request.Reason!.Trim(); }
        return await CommitAsync(task, "TaskTransitioned", previous == TaskStageCategory.Done ? "reopened" : "stageChanged", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> SetBlockedStateAsync(Guid taskId, TaskBlockedStateRequest request, CancellationToken cancellationToken = default)
    {
        var taskResult = await AuthorizedTaskAsync(taskId, true, cancellationToken: cancellationToken);
        if (taskResult.Error is not null) return Fail<TaskCommandResponse>(taskResult.Error.Value.Code, taskResult.Error.Value.Message);
        var task = taskResult.Value!;
        var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (request.IsBlocked && !IsBounded(request.Reason)) return Fail<TaskCommandResponse>("TASK_BLOCK_REASON_REQUIRED", "A blocked reason is required.");
        task.IsBlocked = request.IsBlocked; task.BlockedReason = request.IsBlocked ? request.Reason!.Trim() : null;
        return await CommitAsync(task, "TaskBlockedStateChanged", "blockedStateChanged", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> CancelAsync(Guid taskId, TaskReviewRequest request, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskId, cancellationToken);
        if (task is null) return Fail<TaskCommandResponse>("TASK_NOT_FOUND", "Task not found.");
        var stage = (await projects.ListWorkflowStagesAsync(task.ProjectId, cancellationToken)).FirstOrDefault(item => item.InternalCategory == TaskStageCategory.Cancelled);
        return stage is null ? Fail<TaskCommandResponse>("TASK_INVALID_STAGE", "Cancelled stage is unavailable.") : await TransitionAsync(taskId, new TaskTransitionRequest(stage.Id, request.ExpectedVersion, request.Reason), cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> ReopenAsync(Guid taskId, TaskReviewRequest request, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskId, cancellationToken);
        if (task is null) return Fail<TaskCommandResponse>("TASK_NOT_FOUND", "Task not found.");
        var stage = (await projects.ListWorkflowStagesAsync(task.ProjectId, cancellationToken)).FirstOrDefault(item => item.InternalCategory == TaskStageCategory.Todo)
            ?? (await projects.ListWorkflowStagesAsync(task.ProjectId, cancellationToken)).FirstOrDefault(item => item.InternalCategory == TaskStageCategory.Backlog);
        return stage is null ? Fail<TaskCommandResponse>("TASK_INVALID_STAGE", "A reopen stage is unavailable.") : await TransitionAsync(taskId, new TaskTransitionRequest(stage.Id, request.ExpectedVersion), cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> SetAssigneeAsync(Guid taskId, TaskRelationshipUserRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, true, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!;
        var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (!request.UserId.HasValue && CategoryOf(task) is TaskStageCategory.InProgress or TaskStageCategory.Review) return Fail<TaskCommandResponse>("TASK_ASSIGNEE_REQUIRED", "Active work cannot be unassigned.");
        if (request.UserId.HasValue && !await IsProjectMemberAsync(task.ProjectId, request.UserId.Value, cancellationToken)) return Fail<TaskCommandResponse>("TASK_FORBIDDEN", "The assignee must be a current project member.");
        if (request.UserId == task.ReviewerUserId) return Fail<TaskCommandResponse>("TASK_REVIEWER_MUST_DIFFER", "Reviewer and primary assignee must differ.");
        task.PrimaryAssigneeUserId = request.UserId;
        return await CommitAsync(task, "TaskAssigneeChanged", "assignmentChanged", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> SetTargetGroupAsync(Guid taskId, TaskTargetGroupRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, true, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!;
        var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (request.GroupId.HasValue)
        {
            var group = await groups.GetByIdAsync(request.GroupId.Value, cancellationToken);
            if (group is null || group.WorkspaceId != task.WorkspaceId || group.Status != GroupStatus.Active) return Fail<TaskCommandResponse>("TASK_TARGET_GROUP_REQUIRED", "Target group is not valid for the task workspace.");
        }
        if (!request.GroupId.HasValue && !task.PrimaryAssigneeUserId.HasValue) return Fail<TaskCommandResponse>("TASK_TARGET_GROUP_REQUIRED", "An unassigned task requires a target group.");
        task.TargetGroupId = request.GroupId;
        return await CommitAsync(task, "TaskTargetGroupChanged", "assignmentChanged", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> AddCollaboratorAsync(Guid taskId, TaskCollaboratorRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, true, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!;
        var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (!await IsProjectMemberAsync(task.ProjectId, request.UserId, cancellationToken)) return Fail<TaskCommandResponse>("TASK_FORBIDDEN", "Collaborator must be a current project member.");
        if (!(await projects.ListCollaboratorsAsync(task.Id, cancellationToken)).Any(item => item.UserId == request.UserId)) await projects.AddCollaboratorAsync(new WorkItemCollaborator { TaskItemId = task.Id, UserId = request.UserId, AddedByUserId = Actor(), AddedAt = clock.UtcNow }, cancellationToken);
        return await CommitAsync(task, "TaskCollaboratorAdded", "assignmentChanged", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> RemoveCollaboratorAsync(Guid taskId, Guid collaboratorUserId, long expectedVersion, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, true, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!;
        var stale = EnsureVersion(task, expectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        var collaborator = (await projects.ListCollaboratorsAsync(task.Id, cancellationToken)).FirstOrDefault(item => item.UserId == collaboratorUserId);
        if (collaborator is not null) projects.RemoveCollaborator(collaborator);
        return await CommitAsync(task, "TaskCollaboratorRemoved", "assignmentChanged", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> SetReviewerAsync(Guid taskId, TaskRelationshipUserRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, true, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!;
        var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (request.UserId == task.PrimaryAssigneeUserId) return Fail<TaskCommandResponse>("TASK_REVIEWER_MUST_DIFFER", "Reviewer and primary assignee must differ.");
        if (request.UserId.HasValue && !await IsProjectMemberAsync(task.ProjectId, request.UserId.Value, cancellationToken)) return Fail<TaskCommandResponse>("TASK_FORBIDDEN", "Reviewer must be a current project member.");
        task.ReviewerUserId = request.UserId;
        if (!request.UserId.HasValue) task.ReviewStatus = TaskReviewStatus.None;
        return await CommitAsync(task, "TaskReviewerChanged", "assignmentChanged", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> SubmitReviewAsync(Guid taskId, TaskReviewRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!; var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (!task.PrimaryAssigneeUserId.HasValue || task.PrimaryAssigneeUserId != Actor()) return Fail<TaskCommandResponse>("TASK_FORBIDDEN", "Only the primary assignee may submit review.");
        if (!task.ReviewerUserId.HasValue) return Fail<TaskCommandResponse>("TASK_TRANSITION_GUARD_FAILED", "A reviewer is required to submit review.");
        task.ReviewStatus = TaskReviewStatus.Submitted; task.ReviewSubmittedAt = clock.UtcNow; task.ReviewReturnReason = null;
        return await CommitAsync(task, "TaskReviewSubmitted", "reviewSubmitted", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> AcceptReviewAsync(Guid taskId, TaskReviewRequest request, CancellationToken cancellationToken = default) => await ResolveReviewAsync(taskId, request, TaskReviewStatus.Accepted, cancellationToken);

    public async Task<Result<TaskCommandResponse>> ReturnReviewAsync(Guid taskId, TaskReviewRequest request, CancellationToken cancellationToken = default) => await ResolveReviewAsync(taskId, request, TaskReviewStatus.Returned, cancellationToken);

    public async Task<Result<TaskCommandResponse>> OverrideCompleteAsync(Guid taskId, TaskReviewRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, false, true, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!; var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (!IsBounded(request.Reason)) return Fail<TaskCommandResponse>("TASK_TRANSITION_GUARD_FAILED", "An override reason is required.");
        var done = (await projects.ListWorkflowStagesAsync(task.ProjectId, cancellationToken)).FirstOrDefault(stage => stage.InternalCategory == TaskStageCategory.Done);
        if (done is null) return Fail<TaskCommandResponse>("TASK_INVALID_STAGE", "Done stage is unavailable.");
        task.WorkflowStageId = done.Id; task.Status = TaskItemStatus.Completed; task.ProgressPercent = 100; task.CompletedAt = clock.UtcNow;
        return await CommitAsync(task, "TaskReviewOverrideCompleted", "reviewOverridden", cancellationToken, true, request.Reason);
    }

    public async Task<Result<TaskCommandResponse>> ClaimAsync(Guid taskId, TaskClaimRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, false, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!; var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (task.PrimaryAssigneeUserId.HasValue) return Fail<TaskCommandResponse>("TASK_ALREADY_ASSIGNED", "Task already has a primary assignee.");
        if (!task.TargetGroupId.HasValue || CategoryOf(task) is not (TaskStageCategory.Backlog or TaskStageCategory.Todo) || task.DeletedAt.HasValue) return Fail<TaskCommandResponse>("TASK_CLAIM_NOT_ELIGIBLE", "Task is not eligible for claim.");
        if (await groups.GetMemberAsync(task.TargetGroupId.Value, Actor(), cancellationToken) is null || !await IsProjectMemberAsync(task.ProjectId, Actor(), cancellationToken)) return Fail<TaskCommandResponse>("TASK_CLAIM_GROUP_MEMBERSHIP_REQUIRED", "Current group and project membership are required.");
        task.PrimaryAssigneeUserId = Actor();
        return await CommitAsync(task, "TaskClaimed", "claimed", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> RestoreAsync(Guid taskId, TaskRestoreRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, true, cancellationToken: cancellationToken, includeDeleted: true);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!; var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        task.Restore();
        return await CommitAsync(task, "TaskRestored", "restored", cancellationToken);
    }

    public async Task<Result<TaskCommandResponse>> DeleteAsync(Guid taskId, TaskDeleteRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, true, true, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!;
        var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        task.MarkDeleted(clock.UtcNow);
        return await CommitAsync(task, "TaskDeleted", "deleted", cancellationToken);
    }

    public async Task<Result<TaskWatchStateResponse>> GetWatchStateAsync(Guid taskId, CancellationToken cancellationToken = default)
    {
        var result = await AuthorizedTaskAsync(taskId, false, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskWatchStateResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var state = await projects.GetWatchStateAsync(taskId, Actor(), cancellationToken);
        return Result<TaskWatchStateResponse>.Success(ToWatchResponse(state));
    }

    public Task<Result<TaskWatchStateResponse>> WatchAsync(Guid taskId, TaskWatchRequest request, CancellationToken cancellationToken = default) => SetWatchAsync(taskId, request, true, cancellationToken);
    public Task<Result<TaskWatchStateResponse>> UnwatchAsync(Guid taskId, TaskWatchRequest request, CancellationToken cancellationToken = default) => SetWatchAsync(taskId, request, false, cancellationToken);

    private async Task<Result<TaskWatchStateResponse>> SetWatchAsync(Guid taskId, TaskWatchRequest request, bool watch, CancellationToken cancellationToken)
    {
        var result = await AuthorizedTaskAsync(taskId, false, cancellationToken: cancellationToken);
        if (result.Error is not null) return Fail<TaskWatchStateResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!; if (EnsureVersion(task, request.ExpectedVersion) is not null) return Fail<TaskWatchStateResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry.");
        var state = await projects.GetWatchStateAsync(taskId, Actor(), cancellationToken);
        if (state is null) { state = new WorkItemWatchState { TaskItemId = taskId, UserId = Actor(), UpdatedAt = clock.UtcNow }; await projects.AddWatchStateAsync(state, cancellationToken); }
        state.IsExplicitOptOut = !watch; state.IsWatching = watch; state.UpdatedAt = clock.UtcNow; state.VersionNo++;
        await audit.LogAsync(new AuditLogEntry(Actor(), watch ? "TaskWatchEnabled" : "TaskWatchOptOut", "TaskItem", taskId, "Task watch preference changed.", WorkspaceId: task.WorkspaceId, ProjectId: task.ProjectId), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<TaskWatchStateResponse>.Success(ToWatchResponse(state));
    }

    private async Task<Result<TaskCommandResponse>> ResolveReviewAsync(Guid taskId, TaskReviewRequest request, TaskReviewStatus outcome, CancellationToken cancellationToken)
    {
        var result = await AuthorizedTaskAsync(taskId, true, false, false, cancellationToken: cancellationToken, requireReview: true);
        if (result.Error is not null) return Fail<TaskCommandResponse>(result.Error.Value.Code, result.Error.Value.Message);
        var task = result.Value!; var stale = EnsureVersion(task, request.ExpectedVersion); if (stale is not null) return Fail<TaskCommandResponse>(stale.Value.Code, stale.Value.Message);
        if (task.ReviewStatus != TaskReviewStatus.Submitted) return Fail<TaskCommandResponse>("TASK_TRANSITION_GUARD_FAILED", "Task has not been submitted for review.");
        if (outcome == TaskReviewStatus.Returned && !IsBounded(request.Reason)) return Fail<TaskCommandResponse>("TASK_TRANSITION_GUARD_FAILED", "A review return reason is required.");
        task.ReviewStatus = outcome; task.ReviewResolvedAt = clock.UtcNow; task.ReviewResolvedByUserId = Actor(); task.ReviewReturnReason = outcome == TaskReviewStatus.Returned ? request.Reason!.Trim() : null;
        if (outcome == TaskReviewStatus.Returned && request.ReturnWorkflowStageId.HasValue)
        {
            var stage = await projects.GetWorkflowStageAsync(request.ReturnWorkflowStageId.Value, cancellationToken);
            if (stage is null || stage.ProjectId != task.ProjectId || stage.InternalCategory is TaskStageCategory.Done or TaskStageCategory.Cancelled)
                return Fail<TaskCommandResponse>("TASK_INVALID_STAGE", "Review return target is not available.");
            task.WorkflowStageId = stage.Id;
            task.Status = LegacyStatus(stage.InternalCategory);
        }
        return await CommitAsync(task, outcome == TaskReviewStatus.Accepted ? "TaskReviewAccepted" : "TaskReviewReturned", "reviewResolved", cancellationToken);
    }

    private async Task<(TaskItem? Value, (string Code, string Message)? Error)> AuthorizedTaskAsync(Guid taskId, bool mutate, bool requireAssign = false, bool requireOverride = false, CancellationToken cancellationToken = default, bool includeDeleted = false, bool requireReview = false)
    {
        var task = await projects.GetTaskAsync(taskId, cancellationToken);
        if (!TryActor(out var actor) || task is null || (!includeDeleted && task.DeletedAt.HasValue) || !await projectAuthorization.CanViewProject(actor, task.ProjectId, cancellationToken)) return (null, ("TASK_NOT_FOUND", "Task not found."));
        var project = await projects.GetProjectAsync(task.ProjectId, cancellationToken);
        if (mutate && (project is null || project.DeletedAt.HasValue || project.Status is ProjectStatus.Archived or ProjectStatus.Deleted)) return (null, ("TASK_TRANSITION_GUARD_FAILED", "Project is read-only."));
        var allowed = requireOverride ? await taskAuthorization.CanOverrideTaskReview(actor, task.Id, cancellationToken) : requireReview ? await taskAuthorization.CanReviewTask(actor, task.Id, cancellationToken) : requireAssign ? await taskAuthorization.CanAssignTask(actor, task.Id, cancellationToken) : !mutate || await taskAuthorization.CanUpdateTask(actor, task.Id, cancellationToken);
        return allowed ? (task, null) : (null, ("TASK_FORBIDDEN", "Task operation is not authorized."));
    }

    private async Task<Result<TaskCommandResponse>> CommitAsync(TaskItem task, string action, string change, CancellationToken cancellationToken, bool overrideApplied = false, string? reason = null)
    {
        var actor = Actor();
        await ReconcileAutomaticWatchAsync(task, cancellationToken);
        // Relationship-only commands also advance the aggregate token.  Set it before
        // queuing the transactional invalidation so its version matches the committed row.
        task.VersionNo++;
        await audit.LogAsync(new AuditLogEntry(actor, action, "TaskItem", task.Id, action, WorkspaceId: task.WorkspaceId, ProjectId: task.ProjectId, Metadata: new Dictionary<string, object?> { ["versionBefore"] = task.VersionNo - 1, ["reasonProvided"] = !string.IsNullOrWhiteSpace(reason) }), cancellationToken);
        await invalidations.TaskChangedAsync(task, actor, change, affectedUserIds: RelatedUsers(task), cancellationToken: cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<TaskCommandResponse>.Success(new TaskCommandResponse(await ToResponseAsync(task, actor, cancellationToken), [], overrideApplied));
    }

    private async Task ReconcileAutomaticWatchAsync(TaskItem task, CancellationToken cancellationToken)
    {
        var collaborators = await projects.ListCollaboratorsAsync(task.Id, cancellationToken);
        var sources = new Dictionary<Guid, WorkItemWatchAutomaticSource> { [task.CreatedByUserId] = WorkItemWatchAutomaticSource.Creator };
        void Add(Guid? userId, WorkItemWatchAutomaticSource source) { if (userId.HasValue) sources[userId.Value] = sources.GetValueOrDefault(userId.Value) | source; }
        Add(task.PrimaryAssigneeUserId, WorkItemWatchAutomaticSource.PrimaryAssignee);
        Add(task.ReviewerUserId, WorkItemWatchAutomaticSource.Reviewer);
        foreach (var collaborator in collaborators) Add(collaborator.UserId, WorkItemWatchAutomaticSource.Collaborator);
        var states = (await projects.ListWatchStatesAsync(task.Id, cancellationToken)).ToDictionary(x => x.UserId);
        foreach (var userId in states.Keys.Union(sources.Keys).ToList())
        {
            if (!states.TryGetValue(userId, out var state))
            {
                state = new WorkItemWatchState { TaskItemId = task.Id, UserId = userId, UpdatedAt = clock.UtcNow };
                await projects.AddWatchStateAsync(state, cancellationToken);
            }
            var automaticSources = sources.GetValueOrDefault(userId);
            if (state.AutomaticSources == automaticSources) continue;
            state.AutomaticSources = automaticSources;
            if (!state.IsExplicitOptOut && automaticSources != WorkItemWatchAutomaticSource.None) state.IsWatching = true;
            state.UpdatedAt = clock.UtcNow; state.VersionNo++;
        }
    }

    private async Task<CanonicalTaskResponse> ToResponseAsync(TaskItem task, Guid actor, CancellationToken cancellationToken)
    {
        var stage = task.WorkflowStage ?? (task.WorkflowStageId.HasValue ? await projects.GetWorkflowStageAsync(task.WorkflowStageId.Value, cancellationToken) : null);
        var relationships = await RelationshipsAsync(task, cancellationToken);
        var canUpdate = await taskAuthorization.CanUpdateTask(actor, task.Id, cancellationToken);
        var canAssign = await taskAuthorization.CanAssignTask(actor, task.Id, cancellationToken);
        var canReview = await taskAuthorization.CanReviewTask(actor, task.Id, cancellationToken);
        var categories = (await projects.ListWorkflowStagesAsync(task.ProjectId, cancellationToken)).Select(item => item.InternalCategory).Distinct().ToList();
        var now = DateOnly.FromDateTime(clock.UtcNow.UtcDateTime);
        var end = task.PlannedEndDate ?? task.DueDate;
        var checklist = await projects.ListChecklistAsync(task.Id, cancellationToken);
        var labels = await projects.ListWorkItemLabelsAsync(task.Id, cancellationToken);
        var children = await projects.ListTasksAsync(task.ProjectId, cancellationToken);
        var subresources = new TaskSubresourceSummary(checklist.Count(x => x.IsCompleted), checklist.Count, await projects.CountTaskCommentsAsync(task.Id, cancellationToken), labels.Count, children.Count(x => x.ParentTaskItemId == task.Id));
        return new CanonicalTaskResponse(task.Id, task.TenantId, task.WorkspaceId, task.ProjectId, task.Kind, task.ParentTaskItemId, task.MilestoneId, task.Title, task.Description, task.WorkflowStageId, stage?.Name ?? CategoryOf(task).ToString(), stage?.InternalCategory ?? CategoryOf(task), task.Priority.ToString(), task.IsBlocked, canUpdate || canAssign ? task.BlockedReason : null, task.PlannedStartDate ?? task.StartDate, end, task.DeadlineAt, task.ActualStartAt, task.CompletedAt, task.ProgressPercent, task.ChildTaskItems.Count > 0, task.EstimatedEffortMinutes, relationships.PrimaryAssignee, task.TargetGroupId, relationships.Collaborators.Count, relationships.Reviewer, end.HasValue && end.Value < now && CategoryOf(task) is not (TaskStageCategory.Done or TaskStageCategory.Cancelled), [], task.VersionNo, new TaskCommandPermissions(canUpdate, canAssign, await taskAuthorization.CanDeleteTask(actor, task.Id, cancellationToken), canReview, await taskAuthorization.CanOverrideTaskReview(actor, task.Id, cancellationToken), !task.PrimaryAssigneeUserId.HasValue && task.TargetGroupId.HasValue), categories, task.ReviewStatus, subresources);
    }

    private async Task<TaskRelationshipsResponse> RelationshipsAsync(TaskItem task, CancellationToken cancellationToken)
    {
        TaskPersonSummary? assignee = task.PrimaryAssigneeUserId.HasValue ? await PersonAsync(task.PrimaryAssigneeUserId.Value, cancellationToken) : null;
        TaskPersonSummary? reviewer = task.ReviewerUserId.HasValue ? await PersonAsync(task.ReviewerUserId.Value, cancellationToken) : null;
        var collaborators = new List<TaskPersonSummary>(); foreach (var item in await projects.ListCollaboratorsAsync(task.Id, cancellationToken)) { var person = await PersonAsync(item.UserId, cancellationToken); if (person is not null) collaborators.Add(person); }
        return new TaskRelationshipsResponse(assignee, task.TargetGroupId, collaborators, reviewer, task.VersionNo);
    }

    private async Task<TaskPersonSummary?> PersonAsync(Guid userId, CancellationToken cancellationToken) { var user = await users.GetByIdAsync(userId, cancellationToken); return user is null ? null : new TaskPersonSummary(user.Id, user.DisplayName); }
    private async Task<bool> IsProjectMemberAsync(Guid projectId, Guid userId, CancellationToken cancellationToken) => await projects.GetMemberAsync(projectId, userId, cancellationToken) is not null;
    private async Task<bool> ReviewRequiredAsync(TaskItem task, CancellationToken cancellationToken) => task.ReviewerUserId.HasValue && (await projects.GetWorkflowDefinitionAsync(task.ProjectId, cancellationToken))?.ReviewEnforcementEnabled == true && task.ReviewStatus != TaskReviewStatus.Accepted;
    private static TaskStageCategory CategoryOf(TaskItem task) => task.WorkflowStage?.InternalCategory ?? task.Status switch { TaskItemStatus.InProgress => TaskStageCategory.InProgress, TaskItemStatus.WaitingReview => TaskStageCategory.Review, TaskItemStatus.Completed => TaskStageCategory.Done, TaskItemStatus.Cancelled => TaskStageCategory.Cancelled, _ => TaskStageCategory.Todo };
    private static TaskItemStatus LegacyStatus(TaskStageCategory category) => category switch { TaskStageCategory.InProgress => TaskItemStatus.InProgress, TaskStageCategory.Review => TaskItemStatus.WaitingReview, TaskStageCategory.Done => TaskItemStatus.Completed, TaskStageCategory.Cancelled => TaskItemStatus.Cancelled, _ => TaskItemStatus.NotStarted };
    private static (string Code, string Message)? EnsureVersion(TaskItem task, long expected) => expected == task.VersionNo ? null : ("TASK_STALE_VERSION", "Task has changed. Refetch and retry.");
    private static bool IsBounded(string? value) => !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= 1000;
    private bool TryActor(out Guid actor) { actor = currentUser.UserId ?? Guid.Empty; return currentUser.IsAuthenticated && actor != Guid.Empty; }
    private Guid Actor() => TryActor(out var actor) ? actor : Guid.Empty;
    private static IEnumerable<Guid> RelatedUsers(TaskItem task) => new[] { task.CreatedByUserId, task.PrimaryAssigneeUserId ?? Guid.Empty, task.ReviewerUserId ?? Guid.Empty }.Where(id => id != Guid.Empty);
    private static Result<T> Fail<T>(string code, string message) => Result<T>.Failure($"{code}|{message}");
    private static TaskWatchStateResponse ToWatchResponse(WorkItemWatchState? state) => new(state?.IsWatching ?? false, state?.IsExplicitOptOut ?? false, state is null ? [] : Enum.GetValues<WorkItemWatchAutomaticSource>().Where(x => x != WorkItemWatchAutomaticSource.None && state.AutomaticSources.HasFlag(x)).Select(x => x.ToString()).ToArray(), state?.VersionNo ?? 0);
}
