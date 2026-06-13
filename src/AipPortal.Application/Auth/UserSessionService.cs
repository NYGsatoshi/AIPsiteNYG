using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Auth;

public sealed class UserSessionService(
    ISessionRepository sessions,
    ITenantRepository tenants,
    IAuditLogger auditLogger,
    IClock clock,
    IUnitOfWork unitOfWork) : IUserSessionService
{
    private static readonly TimeSpan LastSeenUpdateInterval = TimeSpan.FromMinutes(5);

    public async Task<SessionValidationResult> ValidateSessionAsync(
        Guid userId,
        Guid sessionId,
        Guid? tenantId,
        bool requireActiveTenantMembership,
        CancellationToken cancellationToken = default)
    {
        var now = clock.UtcNow;
        var session = await sessions.GetByIdWithUserAsync(sessionId, cancellationToken);
        if (session is null || session.UserId != userId)
        {
            return await FailAsync(userId, "SessionNotFound", cancellationToken);
        }

        if (session.RevokedAt.HasValue)
        {
            return await FailAsync(userId, "SessionRevoked", cancellationToken);
        }

        if (session.ExpiresAt <= now)
        {
            return await FailAsync(userId, "SessionExpired", cancellationToken);
        }

        if (session.User is null || session.User.DeletedAt.HasValue || session.User.Status != UserStatus.Active)
        {
            return await FailAsync(userId, "UserInactive", cancellationToken);
        }

        if (requireActiveTenantMembership && tenantId.HasValue)
        {
            var membership = await tenants.GetTenantUserAsync(tenantId.Value, userId, cancellationToken);
            if (membership is null ||
                membership.Status != TenantUserStatus.Active ||
                membership.Tenant is null ||
                membership.Tenant.DeletedAt.HasValue ||
                membership.Tenant.Status != TenantStatus.Active)
            {
                return await FailAsync(userId, "TenantMembershipInactive", cancellationToken);
            }
        }

        if (!session.LastSeenAt.HasValue || now - session.LastSeenAt.Value >= LastSeenUpdateInterval)
        {
            session.LastSeenAt = now;
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return SessionValidationResult.Success();
    }

    public async Task<Result> RevokeSessionAsync(
        Guid sessionId,
        Guid? actorUserId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        var revoked = await sessions.RevokeAsync(sessionId, clock.UtcNow, cancellationToken);
        if (revoked)
        {
            await LogRevocationAsync(actorUserId, reason, 1, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return Result.Success();
    }

    public async Task<Result<int>> RevokeUserSessionsAsync(
        Guid userId,
        Guid? actorUserId,
        string reason,
        Guid? exceptSessionId = null,
        CancellationToken cancellationToken = default)
    {
        var count = await sessions.RevokeUserSessionsAsync(userId, clock.UtcNow, exceptSessionId, cancellationToken);
        if (count > 0)
        {
            await LogRevocationAsync(actorUserId, reason, count, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return Result<int>.Success(count);
    }

    private async Task<SessionValidationResult> FailAsync(
        Guid userId,
        string reason,
        CancellationToken cancellationToken)
    {
        await auditLogger.LogSecurityAsync(
            "SessionValidationFailure",
            "Session validation failed.",
            new Dictionary<string, object?>
            {
                ["userId"] = userId,
                ["reason"] = reason
            },
            SecurityEventSeverity.Warning,
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SessionValidationResult.Failure(reason);
    }

    private async Task LogRevocationAsync(
        Guid? actorUserId,
        string reason,
        int count,
        CancellationToken cancellationToken)
    {
        await auditLogger.LogAsync(new AuditLogEntry(
            actorUserId,
            "SessionRevoked",
            "Session",
            null,
            "User session revoked.",
            Metadata: new Dictionary<string, object?>
            {
                ["reason"] = reason,
                ["count"] = count
            }), cancellationToken);
        await auditLogger.LogSecurityAsync(
            "SessionRevoked",
            "User session revoked.",
            new Dictionary<string, object?>
            {
                ["reason"] = reason,
                ["count"] = count
            },
            cancellationToken: cancellationToken);
    }
}
