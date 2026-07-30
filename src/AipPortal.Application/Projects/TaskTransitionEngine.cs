using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

internal sealed record AppliedTaskTransition(TaskWorkflowStage Stage, TaskStageCategory PreviousCategory, bool Reopened);

/// <summary>
/// Canonical workflow mutation shared by Task Detail and Project Kanban.
/// Authorization, expected-version validation, audit, and persistence remain at
/// each command boundary; every stage guard and stage-owned field mutation lives
/// here so Kanban cannot develop a second transition policy.
/// </summary>
internal static class TaskTransitionEngine
{
    public static async Task<Result<AppliedTaskTransition>> ApplyAsync(
        IProjectRepository projects,
        IClock clock,
        TaskItem task,
        Guid workflowStageId,
        string? reason,
        CancellationToken cancellationToken)
    {
        var stage = await projects.GetWorkflowStageAsync(workflowStageId, cancellationToken);
        if (stage is null || stage.ProjectId != task.ProjectId)
            return Fail("TASK_INVALID_STAGE", "Workflow stage is not available for this task.");

        var previous = CategoryOf(task);
        if (previous is TaskStageCategory.Done or TaskStageCategory.Cancelled &&
            stage.InternalCategory is not (TaskStageCategory.Backlog or TaskStageCategory.Todo))
        {
            return Fail("TASK_TRANSITION_GUARD_FAILED", "Reopen a terminal task to Backlog or Todo before moving it to active work.");
        }

        if (stage.InternalCategory == TaskStageCategory.InProgress && !task.PrimaryAssigneeUserId.HasValue)
            return Fail("TASK_ASSIGNEE_REQUIRED", "A primary assignee is required before active work.");

        var definition = await projects.GetWorkflowDefinitionAsync(task.ProjectId, cancellationToken);
        if (stage.InternalCategory == TaskStageCategory.Done &&
            task.ReviewerUserId.HasValue &&
            definition?.ReviewEnforcementEnabled == true &&
            task.ReviewStatus != TaskReviewStatus.Accepted)
        {
            return Fail("TASK_REVIEW_REQUIRED", "An accepted review is required before completion.");
        }

        if (stage.InternalCategory == TaskStageCategory.Cancelled && !IsBounded(reason))
            return Fail("TASK_CANCEL_REASON_REQUIRED", "A cancellation reason is required.");

        if (stage.InternalCategory == TaskStageCategory.Done &&
            (await projects.ListTasksAsync(task.ProjectId, cancellationToken)).Any(child =>
                child.ParentTaskItemId == task.Id &&
                !child.DeletedAt.HasValue &&
                CategoryOf(child) is not (TaskStageCategory.Done or TaskStageCategory.Cancelled)))
        {
            return Fail("TASK_TRANSITION_GUARD_FAILED", "A parent task with incomplete children cannot be completed.");
        }

        task.WorkflowStageId = stage.Id;
        task.WorkflowStage = stage;
        task.Status = LegacyStatus(stage.InternalCategory);
        var now = clock.UtcNow;
        if (stage.InternalCategory is TaskStageCategory.InProgress or TaskStageCategory.Review && !task.ActualStartAt.HasValue)
            task.ActualStartAt = now;
        if (stage.InternalCategory == TaskStageCategory.Done)
        {
            task.ProgressPercent = 100;
            task.CompletedAt = now;
            task.CancelledAt = null;
            task.CancellationReason = null;
        }

        if (previous == TaskStageCategory.Done && stage.InternalCategory != TaskStageCategory.Done)
        {
            task.CompletedAt = null;
            if (stage.InternalCategory is TaskStageCategory.Backlog or TaskStageCategory.Todo)
                task.ProgressPercent = 0;
        }

        if (previous == TaskStageCategory.Cancelled && stage.InternalCategory is TaskStageCategory.Backlog or TaskStageCategory.Todo)
        {
            task.CancelledAt = null;
            task.CancellationReason = null;
            task.CompletedAt = null;
            task.ProgressPercent = 0;
        }

        if (stage.InternalCategory == TaskStageCategory.Cancelled)
        {
            task.CancelledAt = now;
            task.CancellationReason = reason!.Trim();
        }

        var reopened = previous is TaskStageCategory.Done or TaskStageCategory.Cancelled &&
            stage.InternalCategory is TaskStageCategory.Backlog or TaskStageCategory.Todo;
        return Result<AppliedTaskTransition>.Success(new(stage, previous, reopened));
    }

    internal static TaskStageCategory CategoryOf(TaskItem task) =>
        task.WorkflowStage?.InternalCategory ?? task.Status switch
        {
            TaskItemStatus.InProgress => TaskStageCategory.InProgress,
            TaskItemStatus.WaitingReview => TaskStageCategory.Review,
            TaskItemStatus.Completed => TaskStageCategory.Done,
            TaskItemStatus.Cancelled => TaskStageCategory.Cancelled,
            _ => TaskStageCategory.Todo
        };

    private static TaskItemStatus LegacyStatus(TaskStageCategory category) => category switch
    {
        TaskStageCategory.InProgress => TaskItemStatus.InProgress,
        TaskStageCategory.Review => TaskItemStatus.WaitingReview,
        TaskStageCategory.Done => TaskItemStatus.Completed,
        TaskStageCategory.Cancelled => TaskItemStatus.Cancelled,
        _ => TaskItemStatus.NotStarted
    };

    private static bool IsBounded(string? value) => !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= 1000;
    private static Result<AppliedTaskTransition> Fail(string code, string message) => Result<AppliedTaskTransition>.Failure($"{code}|{message}");
}
