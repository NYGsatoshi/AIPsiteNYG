namespace AipPortal.Application.Artifacts;

public sealed record AttachArtifactEvidenceManifestRequest(
    IReadOnlyList<ArtifactClaimManifestItem> Claims);

public sealed record ArtifactClaimManifestItem(
    int Ordinal,
    string Text,
    bool CitationPresent,
    string SupportStatus,
    string ReviewStatus,
    IReadOnlyList<ArtifactEvidenceManifestItem> Evidence);

public sealed record ArtifactEvidenceManifestItem(
    int Ordinal,
    string SourceKind,
    string SourceReference,
    string? SourceTitleSnapshot,
    string PassageSnapshot,
    string? LocationSnapshot,
    Guid? SourceEventAuditId);

public sealed record ArtifactEvidenceManifestResponse(
    Guid ArtifactVersionId,
    int ClaimCount);
