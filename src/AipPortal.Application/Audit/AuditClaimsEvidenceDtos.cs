namespace AipPortal.Application.Audit;

public sealed record AuditClaimsEvidenceResponse(
    Guid ArtifactId,
    Guid ArtifactVersionId,
    int ArtifactVersionNumber,
    string ArtifactTitle,
    IReadOnlyList<AuditClaimEvidenceResponse> Claims);

public sealed record AuditClaimEvidenceResponse(
    Guid ClaimId,
    int Ordinal,
    string Text,
    bool CitationPresent,
    string SupportStatus,
    string ReviewStatus,
    IReadOnlyList<AuditEvidenceResponse> Evidence);

public sealed record AuditEvidenceResponse(
    Guid EvidenceId,
    int Ordinal,
    string SourceKind,
    string SourceReference,
    string? SourceTitle,
    string Passage,
    string? Location,
    Guid? SourceEventAuditId);
