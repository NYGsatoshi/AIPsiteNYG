using AipPortal.Application.Projects;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AipPortal.Infrastructure.Persistence;

public sealed class ProjectActivationUnitOfWork(AppDbContext dbContext) : IProjectActivationUnitOfWork
{
    public async Task<ProjectActivationSaveResult> SaveActivationAsync(
        CancellationToken cancellationToken = default)
    {
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return ProjectActivationSaveResult.Saved;
        }
        catch (DbUpdateConcurrencyException)
        {
            dbContext.ChangeTracker.Clear();
            return ProjectActivationSaveResult.ConcurrencyConflict;
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation
            })
        {
            dbContext.ChangeTracker.Clear();
            return ProjectActivationSaveResult.UniqueConflict;
        }
        catch (DbUpdateException)
        {
            dbContext.ChangeTracker.Clear();
            return ProjectActivationSaveResult.Failed;
        }
        catch (InvalidOperationException)
        {
            dbContext.ChangeTracker.Clear();
            return ProjectActivationSaveResult.Failed;
        }
    }
}
