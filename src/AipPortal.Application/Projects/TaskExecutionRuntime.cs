namespace AipPortal.Application.Projects;

/// <summary>
/// Opaque server-built capability passed to a future execution runtime. It is
/// deliberately unable to convey URLs, source IDs, file names, bytes, storage
/// keys, credentials, prompts, or provider configuration.
/// </summary>
public sealed record TaskExecutionSnapshotHandle(
    Guid RunId,
    Guid TenantId,
    int SnapshotSchemaVersion);

/// <summary>
/// A foundation runtime may only report whether it accepted the opaque handle.
/// It cannot feed provider or source diagnostics into persistence, audit, or
/// the public API before a separately approved execution contract exists.
/// </summary>
public sealed record TaskExecutionRuntimeStartResult(bool Accepted)
{
    public static TaskExecutionRuntimeStartResult Unavailable() =>
        new(false);
}

public interface ITaskExecutionRuntime
{
    Task<TaskExecutionRuntimeStartResult> StartAsync(
        TaskExecutionSnapshotHandle snapshot,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Foundation runtime. It performs no network, file, provider, or background
/// work and deterministically fails closed until a separately approved runtime
/// contract is composed.
/// </summary>
internal sealed class UnavailableTaskExecutionRuntime : ITaskExecutionRuntime
{
    public Task<TaskExecutionRuntimeStartResult> StartAsync(
        TaskExecutionSnapshotHandle snapshot,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(TaskExecutionRuntimeStartResult.Unavailable());
}
