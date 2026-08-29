namespace AipPortal.Domain.Enums;

public enum ArtifactClaimSupportStatus
{
    Unverified = 0,
    Supported = 1,
    Contradicted = 2,
    Insufficient = 3,
    Unsupported = 4
}

public enum ArtifactClaimReviewStatus
{
    Unreviewed = 0,
    Reviewed = 1
}

public enum ArtifactEvidenceSourceKind
{
    WebSnapshot = 0,
    FileAttachment = 1,
    ArtifactVersion = 2
}
