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
/// An immutable, server-owned Task execution request. The provider identity,
/// runtime contract, ownership chain, and source-policy snapshot never change.
/// Materialization is added by #462 and the normal durable result by #463.
/// </summary>
public sealed class TaskExecutionRun : Entity, ITenantEntity
{
    public const int SnapshotSchemaVersion1 = 1;
    public const int RuntimeContractVersion1 = 1;

    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TaskItemId { get; set; }
    public Guid RequestedByUserId { get; set; }
    /// <summary>The durable acceptance timestamp for this idempotent request.</summary>
    public DateTimeOffset RequestedAtUtc { get; set; }
    public DateTimeOffset? QueuedAtUtc { get; set; }
    public DateTimeOffset? StartedAtUtc { get; set; }
    public DateTimeOffset? FinishedAtUtc { get; set; }
    public TaskExecutionProvider RuntimeProvider { get; set; } = TaskExecutionProvider.FirstPartyProjectFilesRuntimeV1;
    public int RuntimeContractVersion { get; set; } = RuntimeContractVersion1;
    public TaskExecutionRunStatus Status { get; set; } = TaskExecutionRunStatus.Accepted;
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
