using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

/// <summary>
/// Read-time authoritative values for a parent Task.  These values are never a
/// cache of the parent row: every projection must calculate them from direct
/// children using this class.
/// </summary>
public sealed record ParentTaskDerivedValues(
    bool IsDerived,
    DateOnly? PlannedStartDate,
    DateOnly? PlannedEndDate,
    int ProgressPercent);

public static class ParentTaskDerivedValuesCalculator
{
    public static ParentTaskDerivedValues Calculate(
        TaskItem parent,
        IEnumerable<TaskItem> projectTasks,
        Func<TaskItem, TaskStageCategory> categoryOf)
    {
        var children = projectTasks
            .Where(task => task.ParentTaskItemId == parent.Id)
            .Where(task => !task.DeletedAt.HasValue)
            .Where(task => categoryOf(task) != TaskStageCategory.Cancelled)
            .ToArray();

        if (children.Length == 0)
        {
            return new ParentTaskDerivedValues(false, parent.PlannedStartDate ?? parent.StartDate,
                parent.PlannedEndDate ?? parent.DueDate, parent.ProgressPercent);
        }

        var starts = children.Select(task => task.PlannedStartDate ?? task.StartDate).Where(date => date.HasValue).Select(date => date!.Value).ToArray();
        var ends = children.Select(task => task.PlannedEndDate ?? task.DueDate).Where(date => date.HasValue).Select(date => date!.Value).ToArray();
        var estimates = children.Select(task => task.EstimatedEffortMinutes).ToArray();
        var useWeightedProgress = estimates.All(estimate => estimate is > 0);
        var progress = useWeightedProgress
            ? (int)Math.Round(children.Sum(task => task.ProgressPercent * (decimal)task.EstimatedEffortMinutes!.Value) / estimates.Sum(estimate => (decimal)estimate!.Value), MidpointRounding.AwayFromZero)
            : (int)Math.Round(children.Average(task => task.ProgressPercent), MidpointRounding.AwayFromZero);

        return new ParentTaskDerivedValues(
            true,
            starts.Length == 0 ? null : starts.Min(),
            ends.Length == 0 ? null : ends.Max(),
            Math.Clamp(progress, 0, 100));
    }
}

/// <summary>Central deadline semantics for Task detail and subtask summaries.</summary>
public static class TaskDeadlineCalculator
{
    public static bool IsOverdue(TaskItem task, TaskStageCategory category, TimeZoneInfo workspaceTimeZone, DateTimeOffset now, DateOnly? plannedEndOverride = null)
    {
        if (category is TaskStageCategory.Done or TaskStageCategory.Cancelled)
        {
            return false;
        }

        if (task.DeadlineAt.HasValue)
        {
            return task.DeadlineAt.Value < now;
        }

        var plannedEnd = plannedEndOverride ?? task.PlannedEndDate ?? task.DueDate;
        if (!plannedEnd.HasValue)
        {
            return false;
        }

        // Planning dates are whole workspace-local days.  Comparing local dates
        // avoids manufacturing an artificial UTC 23:59:59 deadline and remains
        // correct across daylight-saving transitions.
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, workspaceTimeZone).DateTime);
        return plannedEnd.Value < localToday;
    }
}

public interface ITaskWorkspaceTimeZoneResolver
{
    Task<TimeZoneInfo> ResolveAsync(Guid tenantId, Guid workspaceId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Workspace-specific timezone settings are not yet persisted by this schema.
/// Until they are, TenantSettings is the established workspace-effective
/// fallback, with UTC for absent or invalid values.
/// </summary>
public sealed class TaskWorkspaceTimeZoneResolver(
    AipPortal.Application.Common.Interfaces.IWorkspaceRepository workspaces,
    AipPortal.Application.Common.Interfaces.ITenantPlanRepository tenantPlans) : ITaskWorkspaceTimeZoneResolver
{
    public async Task<TimeZoneInfo> ResolveAsync(Guid tenantId, Guid workspaceId, CancellationToken cancellationToken = default)
    {
        var workspace = await workspaces.GetByIdAsync(workspaceId, cancellationToken);
        var zoneId = workspace?.TenantId == tenantId ? workspace.TimeZone : null;
        zoneId ??= (await tenantPlans.GetTenantSettingsAsync(tenantId, cancellationToken))?.TimeZone;
        if (!string.IsNullOrWhiteSpace(zoneId))
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(zoneId); }
            catch (TimeZoneNotFoundException) { }
            catch (InvalidTimeZoneException) { }
        }

        return TimeZoneInfo.Utc;
    }
}

public static class TaskWatchStateInitializer
{
    public static WorkItemWatchState ForCreator(TaskItem task, Guid creatorUserId, DateTimeOffset now) => new()
    {
        TaskItemId = task.Id,
        UserId = creatorUserId,
        AutomaticSources = WorkItemWatchAutomaticSource.Creator,
        IsWatching = true,
        UpdatedAt = now,
        VersionNo = 1
    };
}
