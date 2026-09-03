using AipPortal.Application.Common;

namespace AipPortal.Application.Audit;

public interface IAuditClaimsEvidenceService
{
    Task<Result<AuditClaimsEvidenceResponse>> GetAsync(
        Guid artifactVersionId,
        CancellationToken cancellationToken = default);
}
