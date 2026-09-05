using System.Text.Json.Serialization;
using AipPortal.Application.Common;

namespace AipPortal.Application.Artifacts;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ArtifactReportRefinementTargetKind
{
    Section = 0,
    Claim = 1
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RefineArtifactReportRequest(
    ArtifactReportRefinementTargetKind TargetKind,
    Guid TargetLogicalId,
    string? Feedback,
    [property: System.ComponentModel.DataAnnotations.Range(typeof(long), "1", "9223372036854775807")] long ConfirmedProjectScopeVersion,
    long? ConfirmedTaskOverrideVersion,
    Guid? ConfirmedResearchPlanRevisionId,
    long? ConfirmedResearchPlanRevisionNo);

public sealed record ArtifactReportRefinementScopeResponse(
    string Origin,
    long ProjectScopeVersion,
    long? TaskOverrideVersion,
    bool WebEnabled,
    bool ProjectFilesEnabled,
    int SourcePolicySchemaVersion,
    Guid? ResearchPlanRevisionId,
    long? ResearchPlanRevisionNo,
    string Provider);

public sealed record ArtifactReportRefinementPreflightResponse(
    Guid ProjectId,
    Guid TaskItemId,
    Guid ArtifactId,
    Guid BaseArtifactVersionId,
    int BaseVersionNumber,
    ArtifactReportRefinementTargetKind TargetKind,
    Guid TargetLogicalId,
    string TargetLabel,
    ArtifactReportRefinementScopeResponse Scope,
    bool CanRefine,
    string? RestrictionCode,
    string ChangesApplyTo);

public sealed record ArtifactReportRefinementResponse(
    Guid ProjectId,
    Guid TaskItemId,
    Guid ArtifactId,
    Guid BaseArtifactVersionId,
    Guid ArtifactVersionId,
    int VersionNumber,
    ArtifactReportRefinementTargetKind TargetKind,
    Guid TargetLogicalId,
    int RefreshedClaimCount,
    int EvidenceAdded);

public interface IArtifactReportRefinementService
{
    Task<Result<ArtifactReportRefinementPreflightResponse>> PreflightAsync(
        Guid projectId,
        Guid baseArtifactVersionId,
        ArtifactReportRefinementTargetKind targetKind,
        Guid targetLogicalId,
        CancellationToken cancellationToken = default);

    Task<Result<ArtifactReportRefinementResponse>> RefineAsync(
        Guid projectId,
        Guid baseArtifactVersionId,
        RefineArtifactReportRequest request,
        CancellationToken cancellationToken = default);
}
