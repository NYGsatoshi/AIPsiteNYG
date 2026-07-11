using AipPortal.Application.Common;

namespace AipPortal.Application.Audit;

public interface IAuditQueryService
{
    Task<Result<PagedResponse<AuditLogListItemResponse>>> ListAuditLogsAsync(AuditLogQuery query, CancellationToken cancellationToken = default);

    Task<Result<PagedResponse<AuditGridRowResponse>>> ListAuditGridAsync(AuditLogQuery query, CancellationToken cancellationToken = default);

    Task<Result<PagedResponse<SecurityEventListItemResponse>>> ListSecurityEventsAsync(SecurityEventQuery query, CancellationToken cancellationToken = default);
}
