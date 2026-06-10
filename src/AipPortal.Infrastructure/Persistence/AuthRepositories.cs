using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;

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

public sealed class EfUnitOfWork(AppDbContext dbContext) : IUnitOfWork
{
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return dbContext.SaveChangesAsync(cancellationToken);
    }
}
