namespace AipPortal.Domain.Enums;

public enum AuditFindingSeverity
{
    Low = 0,
    Medium = 1,
    High = 2,
    Critical = 3
}

public enum AuditFindingTriageStatus
{
    Open = 0,
    Reviewing = 1,
    Resolved = 2,
    AcceptedRisk = 3,
    FalsePositive = 4
}
