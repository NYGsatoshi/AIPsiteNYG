# Data Model

## Conventions

- Primary keys: `Guid Id`.
- Timestamps: `CreatedAtUtc`, `UpdatedAtUtc`, and optional `DeletedAtUtc`.
- Soft delete: use where content should remain auditable or recoverable.
- Names and slugs should be unique only within their required scope.
- Store user-facing enums as strings or configured conversions for readability.
- Add indexes for all foreign keys and common filters.
- Use optimistic concurrency tokens for records likely to be edited by multiple users.

## Auth And Users

### User

- `Id`
- `DisplayName`
- `Email`
- `NormalizedEmail`
- `PasswordHash`
- `Status`
- `LastLoginAtUtc`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

Indexes:

- Unique `NormalizedEmail`
- `Status`

### Session

- `Id`
- `UserId`
- `RefreshTokenHash` or server session key
- `ExpiresAtUtc`
- `RevokedAtUtc`
- `CreatedAtUtc`
- `LastSeenAtUtc`

### Invite

- `Id`
- `WorkspaceId`
- `Email`
- `TokenHash`
- `Role`
- `ExpiresAtUtc`
- `AcceptedAtUtc`
- `CreatedByUserId`
- `CreatedAtUtc`

## Workspaces And Groups

### Workspace

- `Id`
- `Name`
- `Slug`
- `Description`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### WorkspaceMember

- `Id`
- `WorkspaceId`
- `UserId`
- `Role`
- `Status`
- `JoinedAtUtc`

Indexes:

- Unique `(WorkspaceId, UserId)`
- `(WorkspaceId, Role)`

### Group

- `Id`
- `WorkspaceId`
- `Name`
- `Slug`
- `Description`
- `Visibility`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### GroupMember

- `Id`
- `GroupId`
- `UserId`
- `Role`
- `JoinedAtUtc`

Indexes:

- Unique `(GroupId, UserId)`

## Channels And Messaging

### Channel

- `Id`
- `WorkspaceId`
- `GroupId` nullable
- `Name`
- `Slug`
- `Description`
- `Type`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### ChannelMember

- `Id`
- `ChannelId`
- `UserId`
- `Role`
- `JoinedAtUtc`

### Post

- `Id`
- `ChannelId`
- `AuthorUserId`
- `Body`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### PostThread

- `Id`
- `PostId`
- `AuthorUserId`
- `Body`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### Conversation

- `Id`
- `WorkspaceId`
- `Type`
- `CreatedAtUtc`
- `UpdatedAtUtc`

### ConversationMember

- `Id`
- `ConversationId`
- `UserId`
- `JoinedAtUtc`
- `LastReadMessageId` nullable

### Message

- `Id`
- `ConversationId`
- `AuthorUserId`
- `Body`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### ReadState

- `Id`
- `UserId`
- `ScopeType`
- `ScopeId`
- `LastReadItemId`
- `LastReadAtUtc`

Use `ReadState` for channels, conversations, posts, and announcements where a general read marker is useful.

## Announcements And Notifications

### Announcement

- `Id`
- `WorkspaceId`
- `GroupId` nullable
- `Title`
- `Body`
- `RequiresReadConfirmation`
- `PublishedAtUtc`
- `CreatedByUserId`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### AnnouncementRead

- `Id`
- `AnnouncementId`
- `UserId`
- `ReadAtUtc`

Indexes:

- Unique `(AnnouncementId, UserId)`

### Notification

- `Id`
- `RecipientUserId`
- `WorkspaceId` nullable
- `Type`
- `SourceType`
- `SourceId`
- `Title`
- `Body`
- `ReadAtUtc`
- `CreatedAtUtc`

## Files

### Attachment

- `Id`
- `WorkspaceId`
- `OwnerUserId`
- `FileName`
- `ContentType`
- `Extension`
- `SizeBytes`
- `StorageProvider`
- `StorageKey`
- `ScanStatus`
- `CreatedAtUtc`
- `DeletedAtUtc`

### FileScanResult

- `Id`
- `AttachmentId`
- `Status`
- `ScannerName`
- `ResultSummary`
- `ScannedAtUtc`

Attachment links should be represented by scoped join tables when needed, for example `PostAttachment`, `MessageAttachment`, `TaskAttachment`, or `ArtifactVersionAttachment`.

## Projects And Production Tracking

### Project

- `Id`
- `WorkspaceId`
- `GroupId` nullable
- `Name`
- `Slug`
- `Description`
- `Status`
- `StartDate`
- `DueDate`
- `CreatedByUserId`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### ProjectMember

- `Id`
- `ProjectId`
- `UserId`
- `Role`
- `JoinedAtUtc`

### Milestone

- `Id`
- `ProjectId`
- `Name`
- `Description`
- `DueDate`
- `Status`
- `SortOrder`
- `CreatedAtUtc`
- `UpdatedAtUtc`

### Task

Use C# class name `ProjectTask` to avoid confusion with `System.Threading.Tasks.Task`; map it to a `Tasks` database table.

- `Id`
- `ProjectId`
- `MilestoneId` nullable
- `Title`
- `Description`
- `Status`
- `Priority`
- `StartDate`
- `DueDate`
- `ProgressPercent`
- `SortOrder`
- `CreatedByUserId`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### TaskAssignment

- `Id`
- `TaskId`
- `UserId`
- `AssignedByUserId`
- `AssignedAtUtc`

Indexes:

- Unique `(TaskId, UserId)`

### TaskDependency

- `Id`
- `ProjectId`
- `PredecessorTaskId`
- `SuccessorTaskId`
- `DependencyType`
- `CreatedAtUtc`

Initial `DependencyType`: `FinishToStart`.

### ActivityLog

- `Id`
- `ProjectId`
- `TaskId` nullable
- `AuthorUserId`
- `ActivityType`
- `Body`
- `OccurredAtUtc`
- `CreatedAtUtc`

### Artifact

- `Id`
- `ProjectId`
- `TaskId` nullable
- `Name`
- `Description`
- `CurrentVersionId` nullable
- `CreatedByUserId`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

### ArtifactVersion

- `Id`
- `ArtifactId`
- `VersionNumber`
- `AttachmentId`
- `Notes`
- `CreatedByUserId`
- `CreatedAtUtc`

### Comment

- `Id`
- `WorkspaceId`
- `AuthorUserId`
- `TargetType`
- `TargetId`
- `Body`
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

Targets can include project, task, artifact, artifact version, and activity log.

### Feedback

- `Id`
- `WorkspaceId`
- `ProjectId` nullable
- `ArtifactId` nullable
- `TaskId` nullable
- `AuthorUserId`
- `TargetUserId` nullable
- `Body`
- `Rating` nullable
- `CreatedAtUtc`
- `UpdatedAtUtc`
- `DeletedAtUtc`

## UI Shell

### FeatureModule

- `Id`
- `Key`
- `Name`
- `Description`
- `IsEnabled`
- `SortOrder`

### PanelDefinition

- `Id`
- `FeatureModuleId`
- `Key`
- `Name`
- `Route`
- `DefaultDockArea`
- `MinWidth`
- `MinHeight`
- `IsEnabled`

### UserLayout

- `Id`
- `UserId`
- `WorkspaceId` nullable
- `Name`
- `LayoutJson`
- `IsDefault`
- `UpdatedAtUtc`

### CommandDefinition

- `Id`
- `FeatureModuleId` nullable
- `Key`
- `Name`
- `Description`
- `Icon`
- `Route`
- `HandlerKey`
- `IsEnabled`

### RadialMenuProfile

- `Id`
- `UserId` nullable
- `WorkspaceId` nullable
- `Name`
- `Scope`
- `IsDefault`
- `CreatedAtUtc`
- `UpdatedAtUtc`

### RadialMenuItem

- `Id`
- `RadialMenuProfileId`
- `CommandDefinitionId` nullable
- `ParentItemId` nullable
- `Label`
- `Icon`
- `AngleDegrees`
- `SortOrder`
- `PayloadJson`

## Search And Audit

### AuditLog

- `Id`
- `ActorUserId` nullable
- `WorkspaceId` nullable
- `Action`
- `TargetType`
- `TargetId`
- `Summary`
- `MetadataJson`
- `CorrelationId`
- `CreatedAtUtc`

### Search Index Data

Start without a separate search table if PostgreSQL text search is enough. If a unified search table is needed later, use:

- `Id`
- `WorkspaceId`
- `SourceType`
- `SourceId`
- `Title`
- `Body`
- `SearchVector`
- `UpdatedAtUtc`

## Basic Gantt API Shape

Endpoint idea:

```text
GET /api/projects/{projectId}/gantt
```

Response DTO:

```json
{
  "projectId": "guid",
  "tasks": [
    {
      "id": "guid",
      "title": "Task title",
      "startDate": "2026-06-01",
      "dueDate": "2026-06-10",
      "status": "InProgress",
      "priority": "Normal",
      "progressPercent": 35,
      "assignees": [
        { "userId": "guid", "displayName": "Student Name" }
      ],
      "milestoneId": "guid"
    }
  ],
  "milestones": [
    {
      "id": "guid",
      "name": "Milestone",
      "dueDate": "2026-06-15",
      "status": "Open"
    }
  ],
  "dependencies": [
    {
      "predecessorTaskId": "guid",
      "successorTaskId": "guid",
      "type": "FinishToStart"
    }
  ]
}
```

Rules:

- Read-only at first.
- Project member authorization required.
- Return only tasks visible to the requesting user.
- Keep date handling simple: date-only values for planning, UTC timestamps for auditing.
