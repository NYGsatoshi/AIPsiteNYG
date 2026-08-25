using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class TaskExecutionScopeRepository(AppDbContext dbContext) : ITaskExecutionScopeRepository
{
    public Task<ProjectExecutionScope?> GetProjectScopeAsync(Guid projectId, CancellationToken cancellationToken = default) =>
        dbContext.ProjectExecutionScopes
            .AsNoTracking()
            .SingleOrDefaultAsync(scope => scope.ProjectId == projectId, cancellationToken);

    public Task<ProjectExecutionScope?> GetProjectScopeForUpdateAsync(Guid projectId, CancellationToken cancellationToken = default) =>
        dbContext.ProjectExecutionScopes
            .SingleOrDefaultAsync(scope => scope.ProjectId == projectId, cancellationToken);

    public Task<TaskExecutionScopeOverride?> GetTaskOverrideAsync(Guid taskItemId, CancellationToken cancellationToken = default) =>
        dbContext.TaskExecutionScopeOverrides
            .AsNoTracking()
            .SingleOrDefaultAsync(scope => scope.TaskItemId == taskItemId, cancellationToken);

    public Task<TaskExecutionScopeOverride?> GetTaskOverrideForUpdateAsync(Guid taskItemId, CancellationToken cancellationToken = default) =>
        dbContext.TaskExecutionScopeOverrides
            .SingleOrDefaultAsync(scope => scope.TaskItemId == taskItemId, cancellationToken);

    public Task<TaskExecutionRun?> GetLatestRunAsync(Guid taskItemId, CancellationToken cancellationToken = default) =>
        dbContext.TaskExecutionRuns
            .AsNoTracking()
            .Where(run => run.TaskItemId == taskItemId)
            .OrderByDescending(run => run.RequestedAtUtc)
            .ThenByDescending(run => run.Id)
            .FirstOrDefaultAsync(cancellationToken);

    public Task<TaskExecutionRun?> GetRunAsync(Guid runId, CancellationToken cancellationToken = default) =>
        dbContext.TaskExecutionRuns
            .AsNoTracking()
            .SingleOrDefaultAsync(run => run.Id == runId, cancellationToken);

    public Task AddProjectScopeAsync(ProjectExecutionScope scope, CancellationToken cancellationToken = default)
    {
        dbContext.ProjectExecutionScopes.Add(scope);
        return Task.CompletedTask;
    }

    public Task AddTaskOverrideAsync(TaskExecutionScopeOverride scope, CancellationToken cancellationToken = default)
    {
        dbContext.TaskExecutionScopeOverrides.Add(scope);
        return Task.CompletedTask;
    }

    public Task AddRunAsync(TaskExecutionRun run, CancellationToken cancellationToken = default)
    {
        dbContext.TaskExecutionRuns.Add(run);
        return Task.CompletedTask;
    }

    public void RemoveTaskOverride(TaskExecutionScopeOverride scope) =>
        dbContext.TaskExecutionScopeOverrides.Remove(scope);
}
