using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class StudentRecord : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public string? PublicDisplayName { get; set; }
    public string? HomeroomLabel { get; set; }
    public string? HealthNotes { get; set; }
    public string? GuardianContact { get; set; }
    public string? Grades { get; set; }
    public AttendanceStatus? AttendanceStatus { get; set; }
    public string? InternalSensitiveNotes { get; set; }

    public Workspace? Workspace { get; set; }
}
