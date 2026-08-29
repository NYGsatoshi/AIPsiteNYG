using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

public interface IArtifactEvidenceRepository
{
    Task<bool> HasClaimsAsync(Guid artifactVersionId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ArtifactClaim>> ListClaimsAsync(Guid artifactVersionId, CancellationToken cancellationToken = default);

    Task AddClaimsAsync(IReadOnlyCollection<ArtifactClaim> claims, CancellationToken cancellationToken = default);
}
