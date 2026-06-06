using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Announcement : SoftDeletableEntity
{
    public Guid WorkspaceId { get; set; }
    public Guid? GroupId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public bool RequiresReadConfirmation { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Workspace? Workspace { get; set; }
    public Group? Group { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<AnnouncementRead> Reads { get; } = new List<AnnouncementRead>();
}

public sealed class AnnouncementRead : Entity
{
    public Guid AnnouncementId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset ReadAt { get; set; }

    public Announcement? Announcement { get; set; }
    public User? User { get; set; }
}

public sealed class Notification : Entity
{
    public Guid RecipientUserId { get; set; }
    public Guid? WorkspaceId { get; set; }
    public NotificationType Type { get; set; } = NotificationType.System;
    public SourceType SourceType { get; set; }
    public Guid SourceId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Body { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public User? RecipientUser { get; set; }
    public Workspace? Workspace { get; set; }
}
