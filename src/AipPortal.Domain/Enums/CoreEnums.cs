namespace AipPortal.Domain.Enums;

public enum UserStatus
{
    Active = 0,
    Suspended = 1,
    Archived = 2
}

public enum SystemRole
{
    User = 0,
    Staff = 1,
    Admin = 2
}

public enum WorkspaceRole
{
    Member = 0,
    Admin = 1,
    Owner = 2
}

public enum MembershipStatus
{
    Pending = 0,
    Active = 1,
    Suspended = 2
}

public enum GroupRole
{
    Member = 0,
    Manager = 1
}

public enum GroupVisibility
{
    Private = 0,
    Workspace = 1,
    Public = 2
}

public enum ChannelType
{
    Workspace = 0,
    Group = 1,
    Private = 2
}

public enum ChannelRole
{
    Member = 0,
    Moderator = 1
}

public enum ConversationType
{
    Direct = 0,
    Group = 1
}

public enum ReadScopeType
{
    Channel = 0,
    Conversation = 1,
    Post = 2,
    Announcement = 3
}

public enum NotificationType
{
    Message = 0,
    Announcement = 1,
    Assignment = 2,
    Comment = 3,
    Feedback = 4,
    System = 5
}

public enum SourceType
{
    User = 0,
    Session = 1,
    Invite = 2,
    Workspace = 3,
    Group = 4,
    Channel = 5,
    Post = 6,
    Message = 7,
    Announcement = 8,
    Project = 9,
    TaskItem = 10,
    ActivityLog = 11,
    Artifact = 12,
    ArtifactVersion = 13,
    Attachment = 14
}

public enum ProjectStatus
{
    Planning = 0,
    Active = 1,
    OnHold = 2,
    Completed = 3,
    Archived = 4
}

public enum ProjectRole
{
    Member = 0,
    Manager = 1,
    Owner = 2
}

public enum MilestoneStatus
{
    Open = 0,
    InProgress = 1,
    Completed = 2
}

public enum TaskItemStatus
{
    Todo = 0,
    InProgress = 1,
    Blocked = 2,
    Done = 3,
    Canceled = 4
}

public enum TaskPriority
{
    Low = 0,
    Normal = 1,
    High = 2,
    Urgent = 3
}

public enum TaskAssignmentRole
{
    Assignee = 0,
    Reviewer = 1,
    Watcher = 2
}

public enum TaskDependencyType
{
    FinishToStart = 0
}

public enum ActivityLogType
{
    Note = 0,
    StatusUpdate = 1,
    Decision = 2,
    Issue = 3
}

public enum CommentTargetType
{
    Project = 0,
    TaskItem = 1,
    Artifact = 2,
    ArtifactVersion = 3,
    ActivityLog = 4
}

public enum FeedbackTargetType
{
    Project = 0,
    TaskItem = 1,
    Artifact = 2,
    ActivityLog = 3
}

public enum FileScanStatus
{
    Pending = 0,
    Clean = 1,
    Infected = 2,
    Failed = 3,
    Skipped = 4
}

public enum DockArea
{
    Left = 0,
    Right = 1,
    Bottom = 2,
    Center = 3
}

public enum RadialMenuScope
{
    Global = 0,
    Workspace = 1,
    Project = 2
}
