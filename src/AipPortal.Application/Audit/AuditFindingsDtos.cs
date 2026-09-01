namespace AipPortal.Application.Audit;

public sealed record AuditFindingsQuery(
    Guid ArtifactVersionId,
    string? Status = null,
    string? Severity = null,
    bool OpenOnly = false);

public sealed record AuditFindingHistoryResponse(
    string? FromStatus,
    string ToStatus,
    string? Reason,
    DateTimeOffset ChangedAt);

public sealed record AuditFindingResponse(
    Guid FindingId,
    Guid ClaimId,
    int ClaimOrdinal,
    string ClaimText,
    string Severity,
    int ConfidencePercent,
    string DetectorKey,
    string PolicyVersion,
    string Status,
    Guid? OwnerUserId,
    string? OwnerDisplayName,
    string? ResolutionReason,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    Guid? RelatedEvidenceId,
    Guid? RelatedEventId,
    IReadOnlyList<AuditFindingHistoryResponse> History);

public sealed record AuditFindingsResponse(
    Guid ArtifactId,
    Guid ArtifactVersionId,
    int ArtifactVersionNumber,
    string ArtifactTitle,
    bool CanReview,
    IReadOnlyList<AuditFindingResponse> Findings);

public sealed record UpdateAuditFindingTriageRequest(
    string Status,
    string? Reason = null,
    bool TakeOwnership = true);
