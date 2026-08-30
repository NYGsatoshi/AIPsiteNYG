using AipPortal.Application.Common;

namespace AipPortal.Application.Artifacts;

public interface IArtifactEvidenceManifestService
{
    Task<Result<ArtifactEvidenceManifestResponse>> AttachAsync(
        Guid artifactVersionId,
        AttachArtifactEvidenceManifestRequest request,
        CancellationToken cancellationToken = default);
}
