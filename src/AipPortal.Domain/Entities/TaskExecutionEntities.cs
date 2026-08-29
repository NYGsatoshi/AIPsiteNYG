using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

/// <summary>
/// The Project-owned default source policy. It deliberately contains no source
/// identifiers, file metadata, URLs, credentials, or content.
/// </summary>
public sealed class ProjectExecutionScope : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ProjectId { get; set; }
    public bool WebEnabled { get; set; }
    public bool ProjectFilesEnabled { get; set; }
    public long VersionNo { get; set; } = 1;
    public Guid UpdatedByUserId { get; set; }

    public Project? Project { get; set; }
    public User? UpdatedByUser { get; set; }
}

/// <summary>
/// A complete Task-local replacement for the Project default source policy.
/// Its absence means the Task inherits the current Project default.
/// </summary>
public sealed class TaskExecutionScopeOverride : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TaskItemId { get; set; }
    public bool WebEnabled { get; set; }
    public bool ProjectFilesEnabled { get; set; }
    public long VersionNo { get; set; } = 1;
    public Guid UpdatedByUserId { get; set; }

    public Project? Project { get; set; }
    public TaskItem? TaskItem { get; set; }
    public User? UpdatedByUser { get; set; }
}

/// <summary>
/// Immutable policy snapshot for a requested Task execution. This is not an
/// output or source-material snapshot: provider contracts and materialization
/// are intentionally deferred.
/// </summary>
public sealed class TaskExecutionRun : Entity, ITenantEntity
{
    public const int SnapshotSchemaVersion1 = 1;

    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TaskItemId { get; set; }
    public Guid RequestedByUserId { get; set; }
    public DateTimeOffset RequestedAtUtc { get; set; }
    public DateTimeOffset? FinishedAtUtc { get; set; }
    public TaskExecutionRunStatus Status { get; set; } = TaskExecutionRunStatus.Prepared;
    public string? FailureCode { get; set; }
    public long VersionNo { get; set; } = 1;

    public int SnapshotSchemaVersion { get; set; } = SnapshotSchemaVersion1;
    public TaskExecutionScopeOrigin SnapshotScopeOrigin { get; set; }
    public long SnapshotProjectScopeVersion { get; set; }
    public long? SnapshotTaskOverrideVersion { get; set; }
    public bool SnapshotWebEnabled { get; set; }
    public bool SnapshotProjectFilesEnabled { get; set; }

    public Project? Project { get; set; }
    public TaskItem? TaskItem { get; set; }
    public User? RequestedByUser { get; set; }
}
