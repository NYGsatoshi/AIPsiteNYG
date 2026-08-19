using System.Data;
using AipPortal.Application.Common;
using AipPortal.Application.Projects;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Owns the complete WPC-02D activation transaction. SERIALIZABLE gives one
/// coherent database snapshot for current authorization, Project state and
/// configured workflow defaults/templates, then commits every staged effect once.
/// </summary>
public sealed class ProjectActivationUnitOfWork(AppDbContext dbContext) : IProjectActivationUnitOfWork
{
    public async Task<Result> ExecuteActivationAsync(
        Func<CancellationToken, Task<Result>> operation,
        CancellationToken cancellationToken = default)
    {
        if (dbContext.Database.CurrentTransaction is not null)
        {
            return DependencyFailure("A nested Project activation transaction is not allowed.");
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        try
        {
            var result = await operation(cancellationToken);
            if (!result.IsSuccess)
            {
                await RollbackAndClearAsync(transaction);
                return result;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Result.Success();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await RollbackAndClearAsync(transaction);
            throw;
        }
        catch (DbUpdateConcurrencyException)
        {
            await RollbackAndClearAsync(transaction);
            return ConcurrentModification();
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException postgres && IsConflict(postgres))
        {
            await RollbackAndClearAsync(transaction);
            return ConcurrentModification();
        }
        catch (PostgresException exception) when (IsConflict(exception))
        {
            // PostgreSQL may surface SERIALIZABLE/commit failures directly rather
            // than wrapping them in DbUpdateException.
            await RollbackAndClearAsync(transaction);
            return ConcurrentModification();
        }
        catch (DbUpdateException)
        {
            await RollbackAndClearAsync(transaction);
            return DependencyFailure("Project activation persistence failed.");
        }
        catch (InvalidOperationException)
        {
            await RollbackAndClearAsync(transaction);
            return DependencyFailure("Project activation persistence failed.");
        }
    }

    private async Task RollbackAndClearAsync(IDbContextTransaction transaction)
    {
        try
        {
            await transaction.RollbackAsync(CancellationToken.None);
        }
        catch
        {
            // The original failure remains authoritative. Clearing tracking
            // prevents a losing activation graph from leaking into later work.
        }

        dbContext.ChangeTracker.Clear();
    }

    private static bool IsConflict(PostgresException exception) =>
        exception.SqlState is
            "23505" or // unique_violation
            "40001" or // serialization_failure
            "40P01";   // deadlock_detected

    private static Result ConcurrentModification() =>
        Result.Failure(new ApplicationErrorDetail(
            "ConcurrentModification",
            "Project activation raced another current mutation. Refetch the Project before retrying.",
            Target: "project"));

    private static Result DependencyFailure(string message) =>
        Result.Failure(new ApplicationErrorDetail(
            "DependencyUnavailable",
            message));
}
