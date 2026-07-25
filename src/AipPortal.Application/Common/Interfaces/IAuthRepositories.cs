using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

public interface IUserRepository
{
    Task<User?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    Task<User?> GetByNormalizedEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<User>> SearchActiveAsync(string query, int take, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<User>>([]);

    Task<IReadOnlyList<User>> GetActiveByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<User>>([]);

    Task AddAsync(User user, CancellationToken cancellationToken = default);
}

public interface IInviteRepository
{
    Task<Invite?> GetByTokenHashAsync(string tokenHash, CancellationToken cancellationToken = default);
}

public interface ISessionRepository
{
    Task AddAsync(Session session, CancellationToken cancellationToken = default);

    Task<Session?> GetByIdWithUserAsync(Guid sessionId, CancellationToken cancellationToken = default);

    Task<bool> RevokeAsync(Guid sessionId, DateTimeOffset revokedAt, CancellationToken cancellationToken = default);

    Task<int> RevokeUserSessionsAsync(Guid userId, DateTimeOffset revokedAt, Guid? exceptSessionId = null, CancellationToken cancellationToken = default);
}

public interface IUnitOfWork
{
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Task commands use this narrowly-scoped persistence boundary so an EF optimistic
/// concurrency failure can be classified without assigning Task error codes to
/// unrelated aggregates.
/// </summary>
public interface ITaskCommandUnitOfWork : IUnitOfWork
{
    Task<TaskCommandSaveResult> SaveTaskCommandAsync(CancellationToken cancellationToken = default);
}

public enum TaskCommandSaveResult
{
    Saved,
    ConcurrencyConflict,
    UniqueConflict
}
