namespace AipPortal.Application.Common.Interfaces;

public interface IAuditLogger
{
    Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default);
}

public sealed record AuditLogEntry(
    Guid? ActorUserId,
    string Action,
    string TargetType,
    Guid? TargetId,
    string? Summary = null);
