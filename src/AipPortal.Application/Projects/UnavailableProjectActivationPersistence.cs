using AipPortal.Application.Common;

namespace AipPortal.Application.Projects;

/// <summary>
/// Fail-closed activation persistence used by Application-only/minimal hosts.
/// Full hosts replace these registrations from AddInfrastructure().
/// </summary>
public sealed class UnavailableProjectActivationWorkflowStore : IProjectActivationWorkflowStore
{
    public Task<AipPortal.Domain.Entities.TaskWorkflowDefinition?> GetDefinitionAsync(
        Guid projectId,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<AipPortal.Domain.Entities.TaskWorkflowDefinition?>(null);

    public Task<IReadOnlyList<AipPortal.Domain.Entities.TaskWorkflowStage>> ListStagesAsync(
        Guid projectId,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<AipPortal.Domain.Entities.TaskWorkflowStage>>([]);

    public Task AddDefinitionAsync(
        AipPortal.Domain.Entities.TaskWorkflowDefinition definition,
        CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task AddStageAsync(
        AipPortal.Domain.Entities.TaskWorkflowStage stage,
        CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}

public sealed class UnavailableProjectActivationUnitOfWork : IProjectActivationUnitOfWork
{
    public Task<Result> ExecuteActivationAsync(
        Func<CancellationToken, Task<Result>> operation,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(Result.Failure(new ApplicationErrorDetail(
            "DependencyUnavailable",
            "Project activation persistence is unavailable.")));
}
