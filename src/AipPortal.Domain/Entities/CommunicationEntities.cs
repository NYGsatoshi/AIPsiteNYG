using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Announcement : SoftDeletableEntity
{
    public Guid? WorkspaceId { get; set; }
    public Guid? GroupId { get; set; }
    public Guid? ChannelId { get; set; }
    public Guid AuthorUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public AnnouncementPriority Priority { get; set; } = AnnouncementPriority.Normal;
    public bool IsPinned { get; set; }
    public bool RequiresReadConfirmation { get; set; }
    public DateTimeOffset PublishedAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }

    public Workspace? Workspace { get; set; }
    public Group? Group { get; set; }
    public Channel? Channel { get; set; }
    public User? AuthorUser { get; set; }
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
    public Guid UserId { get; set; }
    public NotificationType NotificationType { get; set; } = NotificationType.System;
    public string Title { get; set; } = string.Empty;
    public string? Body { get; set; }
    public string? RelatedEntityType { get; set; }
    public Guid? RelatedEntityId { get; set; }
    public bool IsRead { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }

    public User? User { get; set; }
}
