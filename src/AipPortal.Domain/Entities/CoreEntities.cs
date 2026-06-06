using AipPortal.Domain.Common;

namespace AipPortal.Domain.Entities;

public sealed class User : SoftDeletableEntity
{
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string NormalizedEmail { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
}

public sealed class Session : AuditableEntity;

public sealed class Invite : AuditableEntity;

public sealed class Workspace : SoftDeletableEntity
{
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
}

public sealed class WorkspaceMember : AuditableEntity;

public sealed class Group : SoftDeletableEntity;

public sealed class GroupMember : AuditableEntity;

public sealed class Channel : SoftDeletableEntity;

public sealed class ChannelMember : AuditableEntity;

public sealed class Post : SoftDeletableEntity;

public sealed class PostThread : SoftDeletableEntity;

public sealed class Conversation : AuditableEntity;

public sealed class ConversationMember : AuditableEntity;

public sealed class Message : SoftDeletableEntity;

public sealed class ReadState : Entity;

public sealed class Notification : Entity;

public sealed class Announcement : SoftDeletableEntity;

public sealed class AnnouncementRead : Entity;

public sealed class Project : SoftDeletableEntity;

public sealed class ProjectMember : AuditableEntity;

public sealed class Milestone : AuditableEntity;

public sealed class ProjectTask : SoftDeletableEntity;

public sealed class TaskDependency : Entity;

public sealed class TaskAssignment : Entity;

public sealed class ActivityLog : AuditableEntity;

public sealed class Artifact : SoftDeletableEntity;

public sealed class ArtifactVersion : AuditableEntity;

public sealed class Comment : SoftDeletableEntity;

public sealed class Feedback : SoftDeletableEntity;

public sealed class Attachment : SoftDeletableEntity;

public sealed class FileScanResult : Entity;

public sealed class AuditLog : Entity;

public sealed class FeatureModule : Entity;

public sealed class PanelDefinition : Entity;

public sealed class UserLayout : Entity;

public sealed class CommandDefinition : Entity;

public sealed class RadialMenuProfile : AuditableEntity;

public sealed class RadialMenuItem : Entity;
