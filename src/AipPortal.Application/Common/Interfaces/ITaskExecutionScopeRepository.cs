using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

/// <summary>
/// Persistence boundary for the Task execution-policy foundation. It deliberately
/// exposes only policy records and opaque run metadata, never source material.
/// </summary>
public interface ITaskExecutionScopeRepository
{
    Task<ProjectExecutionScope?> GetProjectScopeAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<ProjectExecutionScope?> GetProjectScopeForUpdateAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<TaskExecutionScopeOverride?> GetTaskOverrideAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<TaskExecutionScopeOverride?> GetTaskOverrideForUpdateAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<TaskExecutionRun?> GetLatestRunAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<TaskExecutionRun?> GetRunAsync(Guid runId, CancellationToken cancellationToken = default);
    Task AddProjectScopeAsync(ProjectExecutionScope scope, CancellationToken cancellationToken = default);
    Task AddTaskOverrideAsync(TaskExecutionScopeOverride scope, CancellationToken cancellationToken = default);
    Task AddRunAsync(TaskExecutionRun run, CancellationToken cancellationToken = default);
    void RemoveTaskOverride(TaskExecutionScopeOverride scope);
}
