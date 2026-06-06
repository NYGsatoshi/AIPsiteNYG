using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;

namespace AipPortal.Infrastructure.Audit;

public sealed class DbAuditLogger(AppDbContext dbContext, IClock clock) : IAuditLogger
{
    public async Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default)
    {
        var targetType = Enum.TryParse<SourceType>(entry.TargetType, ignoreCase: true, out var parsed)
            ? parsed
            : SourceType.User;

        await dbContext.AuditLogs.AddAsync(new AuditLog
        {
            ActorUserId = entry.ActorUserId,
            Action = entry.Action,
            TargetType = targetType,
            TargetId = entry.TargetId ?? Guid.Empty,
            Summary = entry.Summary,
            CreatedAt = clock.UtcNow
        }, cancellationToken);
    }
}
