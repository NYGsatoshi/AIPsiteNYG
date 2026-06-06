using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Attachment : SoftDeletableEntity
{
    public Guid WorkspaceId { get; set; }
    public AttachmentOwnerType? OwnerType { get; set; }
    public Guid? OwnerId { get; set; }
    public Guid OwnerUserId { get; set; }
    public Guid UploadedByUserId { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string StoredFileName { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public string Extension { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string StorageProvider { get; set; } = string.Empty;
    public string StorageKey { get; set; } = string.Empty;
    public FileScanStatus ScanStatus { get; set; } = FileScanStatus.Pending;

    public Workspace? Workspace { get; set; }
    public User? OwnerUser { get; set; }
    public User? UploadedByUser { get; set; }
    public ICollection<FileScanResult> ScanResults { get; } = new List<FileScanResult>();
}

public sealed class FileScanResult : Entity
{
    public Guid AttachmentId { get; set; }
    public FileScanStatus Status { get; set; }
    public string ScannerName { get; set; } = string.Empty;
    public string? ResultSummary { get; set; }
    public DateTimeOffset ScannedAt { get; set; }

    public Attachment? Attachment { get; set; }
}

public sealed class AuditLog : Entity
{
    public Guid? ActorUserId { get; set; }
    public Guid? WorkspaceId { get; set; }
    public string Action { get; set; } = string.Empty;
    public SourceType TargetType { get; set; }
    public Guid TargetId { get; set; }
    public string? Summary { get; set; }
    public string? MetadataJson { get; set; }
    public string? CorrelationId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public User? ActorUser { get; set; }
    public Workspace? Workspace { get; set; }
}

public sealed class FeatureModule : Entity
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsEnabled { get; set; } = true;
    public int SortOrder { get; set; }

    public ICollection<PanelDefinition> PanelDefinitions { get; } = new List<PanelDefinition>();
    public ICollection<CommandDefinition> CommandDefinitions { get; } = new List<CommandDefinition>();
}

public sealed class PanelDefinition : Entity
{
    public Guid FeatureModuleId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Route { get; set; } = string.Empty;
    public DockArea DefaultDockArea { get; set; } = DockArea.Center;
    public int MinWidth { get; set; }
    public int MinHeight { get; set; }
    public bool IsEnabled { get; set; } = true;

    public FeatureModule? FeatureModule { get; set; }
}

public sealed class UserLayout : Entity
{
    public Guid UserId { get; set; }
    public Guid? WorkspaceId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string LayoutJson { get; set; } = "{}";
    public bool IsDefault { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public User? User { get; set; }
    public Workspace? Workspace { get; set; }
}

public sealed class CommandDefinition : Entity
{
    public Guid? FeatureModuleId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Route { get; set; }
    public string? HandlerKey { get; set; }
    public bool IsEnabled { get; set; } = true;

    public FeatureModule? FeatureModule { get; set; }
}

public sealed class RadialMenuProfile : AuditableEntity
{
    public Guid? UserId { get; set; }
    public Guid? WorkspaceId { get; set; }
    public string Name { get; set; } = string.Empty;
    public RadialMenuScope Scope { get; set; } = RadialMenuScope.Global;
    public bool IsDefault { get; set; }

    public User? User { get; set; }
    public Workspace? Workspace { get; set; }
    public ICollection<RadialMenuItem> Items { get; } = new List<RadialMenuItem>();
}

public sealed class RadialMenuItem : Entity
{
    public Guid RadialMenuProfileId { get; set; }
    public Guid? CommandDefinitionId { get; set; }
    public Guid? ParentItemId { get; set; }
    public string Label { get; set; } = string.Empty;
    public string? Icon { get; set; }
    public decimal? AngleDegrees { get; set; }
    public int SortOrder { get; set; }
    public string? PayloadJson { get; set; }

    public RadialMenuProfile? RadialMenuProfile { get; set; }
    public CommandDefinition? CommandDefinition { get; set; }
    public RadialMenuItem? ParentItem { get; set; }
    public ICollection<RadialMenuItem> ChildItems { get; } = new List<RadialMenuItem>();
}
