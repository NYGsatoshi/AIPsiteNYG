using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Project : SoftDeletableEntity
{
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
}

public sealed class ProjectMember : AuditableEntity
{
    public Guid ProjectId { get; set; }
    public Guid UserId { get; set; }
    public ProjectRole Role { get; set; } = ProjectRole.Contributor;
    public DateTimeOffset JoinedAt { get; set; }

    public Project? Project { get; set; }
    public User? User { get; set; }
}

public sealed class Milestone : SoftDeletableEntity
{
    public Guid ProjectId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateOnly? DueDate { get; set; }
    public MilestoneStatus Status { get; set; } = MilestoneStatus.NotStarted;
    public int SortOrder { get; set; }

    public Project? Project { get; set; }
    public ICollection<TaskItem> Tasks { get; } = new List<TaskItem>();
}

public sealed class TaskItem : SoftDeletableEntity
{
    public Guid ProjectId { get; set; }
    public Guid? MilestoneId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public TaskItemStatus Status { get; set; } = TaskItemStatus.NotStarted;
    public TaskPriority Priority { get; set; } = TaskPriority.Normal;
    public DateOnly? StartDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public int ProgressPercent { get; set; }
    public int SortOrder { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Project? Project { get; set; }
    public Milestone? Milestone { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<TaskAssignment> Assignments { get; } = new List<TaskAssignment>();
    public ICollection<TaskDependency> PredecessorDependencies { get; } = new List<TaskDependency>();
    public ICollection<TaskDependency> SuccessorDependencies { get; } = new List<TaskDependency>();
}

public sealed class TaskAssignment : Entity
{
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

public sealed class TaskDependency : AuditableEntity
{
    public Guid ProjectId { get; set; }
    public Guid PredecessorTaskItemId { get; set; }
    public Guid SuccessorTaskItemId { get; set; }
    public TaskDependencyType DependencyType { get; set; } = TaskDependencyType.FinishToStart;

    public Project? Project { get; set; }
    public TaskItem? PredecessorTaskItem { get; set; }
    public TaskItem? SuccessorTaskItem { get; set; }
}

public sealed class ActivityLog : AuditableEntity
{
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

public sealed class Artifact : SoftDeletableEntity
{
    public Guid ProjectId { get; set; }
    public Guid? TaskItemId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Guid? CurrentVersionId { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Project? Project { get; set; }
    public TaskItem? TaskItem { get; set; }
    public ArtifactVersion? CurrentVersion { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<ArtifactVersion> Versions { get; } = new List<ArtifactVersion>();
}

public sealed class ArtifactVersion : AuditableEntity
{
    public Guid ArtifactId { get; set; }
    public int VersionNumber { get; set; }
    public Guid AttachmentId { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Artifact? Artifact { get; set; }
    public Attachment? Attachment { get; set; }
    public User? CreatedByUser { get; set; }
}

public sealed class Comment : SoftDeletableEntity
{
    public Guid WorkspaceId { get; set; }
    public Guid AuthorUserId { get; set; }
    public CommentTargetType TargetType { get; set; }
    public Guid TargetId { get; set; }
    public string Body { get; set; } = string.Empty;

    // Application use cases must authorize comments per TargetType before reading or writing.
    public Workspace? Workspace { get; set; }
    public User? AuthorUser { get; set; }
}

public sealed class Feedback : SoftDeletableEntity
{
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
