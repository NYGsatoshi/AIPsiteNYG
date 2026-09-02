using AipPortal.Application.Common;

namespace AipPortal.Application.Audit;

public interface IAuditFindingDecisionService
{
    Task<Result<AuditFindingDecisionResponse>> GetAsync(
        Guid findingId,
        CancellationToken cancellationToken = default);

    Task<Result<AuditFindingDecisionResponse>> SaveAsync(
        Guid findingId,
        SaveAuditFindingDecisionRequest request,
        CancellationToken cancellationToken = default);
}
