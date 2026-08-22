using AipPortal.Application.Common;

namespace AipPortal.Application.Projects;

/// <summary>
/// Owns the complete canonical activation transaction. Database-dependent
/// authorization, scope/default resolution, staging, persistence and commit must
/// execute inside the callback so activation observes one serializable snapshot.
/// </summary>
public interface IProjectActivationUnitOfWork
{
    Task<Result> ExecuteActivationAsync(
        Func<CancellationToken, Task<Result>> operation,
        CancellationToken cancellationToken = default);
}
