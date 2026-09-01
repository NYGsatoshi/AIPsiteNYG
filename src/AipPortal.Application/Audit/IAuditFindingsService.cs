using AipPortal.Application.Common;

namespace AipPortal.Application.Audit;

public interface IAuditFindingsService
{
    Task<Result<AuditFindingsResponse>> ListAsync(
        AuditFindingsQuery query,
        CancellationToken cancellationToken = default);

    Task<Result> UpdateTriageAsync(
        Guid findingId,
        UpdateAuditFindingTriageRequest request,
        CancellationToken cancellationToken = default);
}
