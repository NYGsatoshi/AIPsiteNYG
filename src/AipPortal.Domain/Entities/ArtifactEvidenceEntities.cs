using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

/// <summary>
/// Immutable verification claim owned by one ArtifactVersion.
/// </summary>
public sealed class ArtifactClaim : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ArtifactVersionId { get; set; }
    public int Ordinal { get; set; }
    public string Text { get; set; } = string.Empty;
    public bool CitationPresent { get; set; }
    public ArtifactClaimSupportStatus SupportStatus { get; set; } = ArtifactClaimSupportStatus.Unverified;
    public ArtifactClaimReviewStatus ReviewStatus { get; set; } = ArtifactClaimReviewStatus.Unreviewed;

    public ArtifactVersion? ArtifactVersion { get; set; }
    public ICollection<ArtifactEvidence> Evidence { get; } = new List<ArtifactEvidence>();
}

/// <summary>
/// Immutable, bounded source passage snapshot attached to a claim.
/// The SourceReference is opaque and never authorizes retrieval by itself.
/// </summary>
public sealed class ArtifactEvidence : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ArtifactClaimId { get; set; }
    public int Ordinal { get; set; }
    public ArtifactEvidenceSourceKind SourceKind { get; set; }
    public string SourceReference { get; set; } = string.Empty;
    public string? SourceTitleSnapshot { get; set; }
    public string PassageSnapshot { get; set; } = string.Empty;
    public string? LocationSnapshot { get; set; }
    public Guid? SourceEventAuditId { get; set; }

    public ArtifactClaim? ArtifactClaim { get; set; }
}
