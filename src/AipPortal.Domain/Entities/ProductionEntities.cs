using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Project : SoftDeletableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid? GroupId { get; set; }
    public Guid OwnerUserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public ProjectStatus Status { get; set; } = ProjectStatus.Planning;
    public DateOnly? StartDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Workspace? Workspace { get; set; }
    public Group? Group { get; set; }
    public User? CreatedByUser { get; set; }
    public User? OwnerUser { get; set; }
    public ICollection<ProjectMember> Members { get; } = new List<ProjectMember>();
    public ICollection<Milestone> Milestones { get; } = new List<Milestone>();
    public ICollection<TaskItem> Tasks { get; } = new List<TaskItem>();
    public ICollection<TaskWorkflowDefinition> TaskWorkflowDefinitions { get; } = new List<TaskWorkflowDefinition>();
}

public sealed class ProjectMember : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid UserId { get; set; }
    public ProjectRole Role { get; set; } = ProjectRole.Contributor;
    public DateTimeOffset JoinedAt { get; set; }

    public Project? Project { get; set; }
    public User? User { get; set; }
}

public sealed class Milestone : SoftDeletableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateOnly? DueDate { get; set; }
    public MilestoneStatus Status { get; set; } = MilestoneStatus.NotStarted;
    public int SortOrder { get; set; }

    public Project? Project { get; set; }
    public ICollection<TaskItem> Tasks { get; } = new List<TaskItem>();
}

public sealed class TaskItem : SoftDeletableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid? MilestoneId { get; set; }
    public Guid? ParentTaskItemId { get; set; }
    public Guid? WorkflowStageId { get; set; }
    public WorkItemKind Kind { get; set; } = WorkItemKind.Task;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public TaskItemStatus Status { get; set; } = TaskItemStatus.NotStarted;
    public TaskPriority Priority { get; set; } = TaskPriority.Medium;
    public DateOnly? StartDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public bool IsBlocked { get; set; }
    public string? BlockedReason { get; set; }
    public Guid? TargetGroupId { get; set; }
    public Guid? PrimaryAssigneeUserId { get; set; }
    public Guid? ReviewerUserId { get; set; }
    public DateOnly? PlannedStartDate { get; set; }
    public DateOnly? PlannedEndDate { get; set; }
    public DateTimeOffset? DeadlineAt { get; set; }
    public DateTimeOffset? ActualStartAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public int? EstimatedEffortMinutes { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancellationReason { get; set; }
    public long SortKey { get; set; }
    public long VersionNo { get; set; } = 1;
    public int ProgressPercent { get; set; }
    public int SortOrder { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Project? Project { get; set; }
    public Milestone? Milestone { get; set; }
    public TaskItem? ParentTaskItem { get; set; }
    public ICollection<TaskItem> ChildTaskItems { get; } = new List<TaskItem>();
    public TaskWorkflowStage? WorkflowStage { get; set; }
    public Group? TargetGroup { get; set; }
    public User? PrimaryAssigneeUser { get; set; }
    public User? ReviewerUser { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<TaskAssignment> Assignments { get; } = new List<TaskAssignment>();
    public ICollection<TaskDependency> PredecessorDependencies { get; } = new List<TaskDependency>();
    public ICollection<TaskDependency> SuccessorDependencies { get; } = new List<TaskDependency>();
    public ICollection<WorkItemCollaborator> Collaborators { get; } = new List<WorkItemCollaborator>();
}

public sealed class TaskWorkflowDefinition : Entity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ProjectId { get; set; }
    public string Name { get; set; } = "Default";
    public bool ReviewEnforcementEnabled { get; set; } = true;
    public long VersionNo { get; set; } = 1;

    public Project? Project { get; set; }
    public ICollection<TaskWorkflowStage> Stages { get; } = new List<TaskWorkflowStage>();
}

public sealed class TaskWorkflowStage : Entity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DefinitionId { get; set; }
    public string Name { get; set; } = string.Empty;
    public TaskStageCategory InternalCategory { get; set; }
    public long SortKey { get; set; }
    public int? WipWarningLimit { get; set; }
    public bool IsInitialStage { get; set; }
    public bool IsTerminalStage { get; set; }
    public long VersionNo { get; set; } = 1;

    public TaskWorkflowDefinition? Definition { get; set; }
}

public sealed class WorkItemCollaborator : Entity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid TaskItemId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset AddedAt { get; set; }
    public Guid AddedByUserId { get; set; }

    public TaskItem? TaskItem { get; set; }
    public User? User { get; set; }
    public User? AddedByUser { get; set; }
}

/// <summary>Immutable migration findings retained for operator review before command cutover.</summary>
public sealed class TaskMigrationInventory : Entity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid? TaskItemId { get; set; }
    public string FindingCode { get; set; } = string.Empty;
    public string Details { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class TaskAssignment : Entity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid TaskItemId { get; set; }
    public Guid UserId { get; set; }
    public TaskAssignmentRole Role { get; set; } = TaskAssignmentRole.Assignee;
    public Guid AssignedByUserId { get; set; }
    public decimal? EstimatedHours { get; set; }
    public decimal? ActualHours { get; set; }
    public DateTimeOffset AssignedAt { get; set; }

    public TaskItem? TaskItem { get; set; }
    public User? User { get; set; }
    public User? AssignedByUser { get; set; }
}

public sealed class TaskDependency : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid PredecessorTaskItemId { get; set; }
    public Guid SuccessorTaskItemId { get; set; }
    public TaskDependencyType DependencyType { get; set; } = TaskDependencyType.FinishToStart;

    public Project? Project { get; set; }
    public TaskItem? PredecessorTaskItem { get; set; }
    public TaskItem? SuccessorTaskItem { get; set; }
}

public sealed class ActivityLog : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid? TaskItemId { get; set; }
    public Guid AuthorUserId { get; set; }
    public ActivityLogType ActivityType { get; set; } = ActivityLogType.Note;
    public string Body { get; set; } = string.Empty;
    public DateTimeOffset OccurredAt { get; set; }

    public Project? Project { get; set; }
    public TaskItem? TaskItem { get; set; }
    public User? AuthorUser { get; set; }
}

public sealed class Artifact : SoftDeletableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid? TaskItemId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public ArtifactType ArtifactType { get; set; } = ArtifactType.Other;
    public ArtifactStatus Status { get; set; } = ArtifactStatus.Draft;
    public Guid? CurrentVersionId { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Project? Project { get; set; }
    public TaskItem? TaskItem { get; set; }
    public ArtifactVersion? CurrentVersion { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<ArtifactVersion> Versions { get; } = new List<ArtifactVersion>();
}

public sealed class ArtifactVersion : SoftDeletableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ArtifactId { get; set; }
    public int VersionNumber { get; set; }
    public Guid AttachmentId { get; set; }
    public Guid? FileObjectId { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Artifact? Artifact { get; set; }
    public Attachment? Attachment { get; set; }
    public FileObject? FileObject { get; set; }
    public User? CreatedByUser { get; set; }
}

public sealed class Comment : SoftDeletableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid AuthorUserId { get; set; }
    public CommentTargetType TargetType { get; set; }
    public Guid TargetId { get; set; }
    public string Body { get; set; } = string.Empty;

    // Application use cases must authorize comments per TargetType before reading or writing.
    public Workspace? Workspace { get; set; }
    public User? AuthorUser { get; set; }
}

public sealed class Feedback : SoftDeletableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid AuthorUserId { get; set; }
    public Guid? TargetUserId { get; set; }
    public FeedbackTargetType TargetType { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid? TaskItemId { get; set; }
    public Guid? ArtifactId { get; set; }
    public Guid? ActivityLogId { get; set; }
    public string Body { get; set; } = string.Empty;
    public int? Rating { get; set; }

    // Only one target reference should be populated per feedback item; validate this in Application use cases.
    public Workspace? Workspace { get; set; }
    public User? AuthorUser { get; set; }
    public User? TargetUser { get; set; }
    public Project? Project { get; set; }
    public TaskItem? TaskItem { get; set; }
    public Artifact? Artifact { get; set; }
    public ActivityLog? ActivityLog { get; set; }
}
