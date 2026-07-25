using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AipPortal.Infrastructure.Persistence;

public sealed class UserRepository(AppDbContext dbContext) : IUserRepository
{
    public Task<User?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        return dbContext.Users.FirstOrDefaultAsync(user => user.Id == id, cancellationToken);
    }

    public Task<User?> GetByNormalizedEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default)
    {
        return dbContext.Users.FirstOrDefaultAsync(user => user.NormalizedEmail == normalizedEmail, cancellationToken);
    }

    public async Task<IReadOnlyList<User>> SearchActiveAsync(string query, int take, CancellationToken cancellationToken = default)
    {
        var normalized = query.Trim().ToUpperInvariant();
        return await dbContext.Users.AsNoTracking()
            .Where(user => user.DeletedAt == null && user.Status == UserStatus.Active && user.DisplayName.ToUpper().Contains(normalized))
            .OrderBy(user => user.DisplayName).ThenBy(user => user.Id).Take(take).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<User>> GetActiveByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0) return [];
        return await dbContext.Users.AsNoTracking().Where(user => ids.Contains(user.Id) && user.DeletedAt == null && user.Status == UserStatus.Active).ToListAsync(cancellationToken);
    }

    public async Task AddAsync(User user, CancellationToken cancellationToken = default)
    {
        await dbContext.Users.AddAsync(user, cancellationToken);
    }
}

public sealed class InviteRepository(AppDbContext dbContext) : IInviteRepository
{
    public Task<Invite?> GetByTokenHashAsync(string tokenHash, CancellationToken cancellationToken = default)
    {
        return dbContext.Invites.FirstOrDefaultAsync(invite => invite.TokenHash == tokenHash, cancellationToken);
    }
}

public sealed class SessionRepository(AppDbContext dbContext) : ISessionRepository
{
    public async Task AddAsync(Session session, CancellationToken cancellationToken = default)
    {
        await dbContext.Sessions.AddAsync(session, cancellationToken);
    }

    public Task<Session?> GetByIdWithUserAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        return dbContext.Sessions
            .Include(session => session.User)
            .FirstOrDefaultAsync(session => session.Id == sessionId, cancellationToken);
    }

    public async Task<bool> RevokeAsync(Guid sessionId, DateTimeOffset revokedAt, CancellationToken cancellationToken = default)
    {
        var session = await dbContext.Sessions.FirstOrDefaultAsync(item => item.Id == sessionId, cancellationToken);
        if (session is not null && !session.RevokedAt.HasValue)
        {
            session.RevokedAt = revokedAt;
            return true;
        }

        return false;
    }

    public async Task<int> RevokeUserSessionsAsync(Guid userId, DateTimeOffset revokedAt, Guid? exceptSessionId = null, CancellationToken cancellationToken = default)
    {
        var query = dbContext.Sessions
            .Where(session => session.UserId == userId && !session.RevokedAt.HasValue);

        if (exceptSessionId.HasValue)
        {
            query = query.Where(session => session.Id != exceptSessionId.Value);
        }

        var activeSessions = await query.ToListAsync(cancellationToken);
        foreach (var session in activeSessions)
        {
            session.RevokedAt = revokedAt;
        }

        return activeSessions.Count;
    }
}

public sealed class EfUnitOfWork(AppDbContext dbContext) : IUnitOfWork, ITaskCommandUnitOfWork
{
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<TaskCommandSaveResult> SaveTaskCommandAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return TaskCommandSaveResult.Saved;
        }
        catch (DbUpdateConcurrencyException)
        {
            // A failed EF save leaves original values and Added audit/outbox rows tracked.
            // This context is request-scoped, but clearing also makes a same-request retry safe.
            dbContext.ChangeTracker.Clear();
            return TaskCommandSaveResult.ConcurrencyConflict;
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent create can race a unique Task subresource constraint.
            // Nothing from the attempted command, audit, or outbox may remain tracked.
            dbContext.ChangeTracker.Clear();
            return TaskCommandSaveResult.ConcurrencyConflict;
        }
    }
}
