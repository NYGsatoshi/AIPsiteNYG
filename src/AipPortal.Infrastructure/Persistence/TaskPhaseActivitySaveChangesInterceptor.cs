using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Persists a typed Task Activity entry for every accepted Workflow Stage change.
/// The Workflow Stage remains the authority for the current phase; ActivityLog is
/// durable history and never needs to be parsed to recover current state.
/// </summary>
public sealed class TaskPhaseActivitySaveChangesInterceptor(
    ICurrentUser currentUser,
    IClock clock) : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        Apply(eventData.Context, currentUser.UserId, clock.UtcNow);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Apply(eventData.Context, currentUser.UserId, clock.UtcNow);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    internal static void Apply(DbContext? context, Guid? actorUserId, DateTimeOffset occurredAt)
    {
        if (context is null)
            return;

        var transitions = context.ChangeTracker.Entries<TaskItem>()
            .Where(entry => entry.State == EntityState.Modified)
            .Where(entry => entry.Property(task => task.WorkflowStageId).IsModified)
            .Where(entry => entry.Property(task => task.WorkflowStageId).OriginalValue != entry.Entity.WorkflowStageId)
            .ToArray();

        if (transitions.Length == 0)
            return;

        if (!actorUserId.HasValue)
            throw new InvalidOperationException("TASK_PHASE_ACTIVITY_AUTHOR_REQUIRED|A workflow phase change requires an authenticated activity author.");

        foreach (var entry in transitions)
        {
            var task = entry.Entity;
            if (context.ChangeTracker.Entries<ActivityLog>().Any(activity =>
                    activity.State == EntityState.Added &&
                    activity.Entity.TaskItemId == task.Id &&
                    activity.Entity.ActivityType == ActivityLogType.StatusUpdate))
            {
                continue;
            }

            var phaseName = task.WorkflowStage?.Name?.Trim();
            var body = string.IsNullOrWhiteSpace(phaseName)
                ? "Workflow phase changed."
                : $"Workflow phase changed to {phaseName}.";

            context.Add(new ActivityLog
            {
                TenantId = task.TenantId,
                ProjectId = task.ProjectId,
                TaskItemId = task.Id,
                AuthorUserId = actorUserId.Value,
                ActivityType = ActivityLogType.StatusUpdate,
                Body = body,
                OccurredAt = occurredAt,
                CreatedAt = occurredAt
            });
        }
    }
}
