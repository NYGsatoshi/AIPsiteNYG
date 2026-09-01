using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

/// <summary>
/// Immutable detector/policy finding bound to one canonical ArtifactClaim.
/// Triage fields are mutable; the parent Claim/Evidence projection remains immutable.
/// </summary>
public sealed class ArtifactFinding : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ArtifactClaimId { get; set; }
    public AuditFindingSeverity Severity { get; set; }
    public int ConfidencePercent { get; set; }
    public string DetectorKey { get; set; } = string.Empty;
    public string PolicyVersion { get; set; } = string.Empty;
    public AuditFindingTriageStatus Status { get; set; } = AuditFindingTriageStatus.Open;
    public Guid? OwnerUserId { get; set; }
    public string? ResolutionReason { get; set; }

    public ArtifactClaim? ArtifactClaim { get; set; }
    public ICollection<AuditFindingHistory> History { get; } = new List<AuditFindingHistory>();
}

/// <summary>
/// Append-only audit-facing transition history for one finding.
/// </summary>
public sealed class AuditFindingHistory : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ArtifactFindingId { get; set; }
    public AuditFindingTriageStatus? FromStatus { get; set; }
    public AuditFindingTriageStatus ToStatus { get; set; }
    public Guid? OwnerUserId { get; set; }
    public string? Reason { get; set; }
    public Guid ChangedByUserId { get; set; }

    public ArtifactFinding? Finding { get; set; }
}
