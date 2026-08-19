using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

/// <summary>
/// Reusable Tenant-owned Task workflow template. Workspace and Tenant defaults
/// reference this identity; activation copies the selected immutable snapshot
/// into the Project-owned TaskWorkflowDefinition/TaskWorkflowStage aggregate.
/// </summary>
public sealed class TaskWorkflowTemplate : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool ReviewEnforcementEnabled { get; set; } = true;
    public long VersionNo { get; set; } = 1;

    public ICollection<TaskWorkflowTemplateStage> Stages { get; } = new List<TaskWorkflowTemplateStage>();
}

public sealed class TaskWorkflowTemplateStage : Entity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid TemplateId { get; set; }
    public string Name { get; set; } = string.Empty;
    public TaskStageCategory InternalCategory { get; set; }
    public long SortKey { get; set; }
    public int? WipWarningLimit { get; set; }
    public bool IsInitialStage { get; set; }
    public bool IsTerminalStage { get; set; }
    public long VersionNo { get; set; } = 1;

    public TaskWorkflowTemplate? Template { get; set; }
}
