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
    Teacher = 2,
    Admin = 3,
    SystemAdmin = 4
}

public enum WorkspaceStatus
{
    Active = 0,
    Archived = 1
}

public enum WorkspaceRole
{
    Owner = 0,
    Admin = 1,
    Adviser = 2,
    Member = 3,
    ReadOnly = 4
}

public enum MembershipStatus
{
    Pending = 0,
    Active = 1,
    Suspended = 2
}

public enum GroupRole
{
    Owner = 0,
    Admin = 1,
    Adviser = 2,
    Member = 3,
    ReadOnly = 4
}

public enum GroupType
{
    Committee = 0,
    Club = 1,
    ProjectGroup = 2,
    Team = 3,
    Temporary = 4,
    Other = 5
}

public enum GroupStatus
{
    Active = 0,
    Archived = 1
}

public enum ChannelType
{
    Public = 0,
    Private = 1,
    Announcement = 2,
    Confidential = 3
}

public enum ChannelStatus
{
    Active = 0,
    Archived = 1
}

public enum ChannelRole
{
    Admin = 0,
    Member = 1,
    ReadOnly = 2
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
