namespace AipPortal.Application.Projects;

public enum ProjectActivationSaveResult
{
    Saved,
    ConcurrencyConflict,
    UniqueConflict,
    Failed
}

/// <summary>
/// Persistence boundary for the single atomic activation save. Infrastructure
/// maps provider-specific concurrency/uniqueness failures into stable outcomes.
/// </summary>
public interface IProjectActivationUnitOfWork
{
    Task<ProjectActivationSaveResult> SaveActivationAsync(
        CancellationToken cancellationToken = default);
}
