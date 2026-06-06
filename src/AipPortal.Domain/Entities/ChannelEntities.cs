using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Channel : SoftDeletableEntity
{
    public Guid WorkspaceId { get; set; }
    public Guid GroupId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public ChannelType Type { get; set; } = ChannelType.Public;
    public ChannelStatus Status { get; set; } = ChannelStatus.Active;
    public Guid CreatedByUserId { get; set; }

    public Workspace? Workspace { get; set; }
    public Group? Group { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<ChannelMember> Members { get; } = new List<ChannelMember>();
    public ICollection<Post> Posts { get; } = new List<Post>();
}

public sealed class ChannelMember : AuditableEntity
{
    public Guid ChannelId { get; set; }
    public Guid UserId { get; set; }
    public ChannelRole Role { get; set; } = ChannelRole.Member;
    public DateTimeOffset JoinedAt { get; set; }

    public Channel? Channel { get; set; }
    public User? User { get; set; }
}

public sealed class Post : SoftDeletableEntity
{
    public Guid ChannelId { get; set; }
    public Guid AuthorUserId { get; set; }
    public string Body { get; set; } = string.Empty;
    public DateTimeOffset? EditedAt { get; set; }
    public DateTimeOffset? PinnedAt { get; set; }
    public Guid? PinnedByUserId { get; set; }

    public Channel? Channel { get; set; }
    public User? AuthorUser { get; set; }
    public User? PinnedByUser { get; set; }
    public ICollection<PostThread> Threads { get; } = new List<PostThread>();
}

public sealed class PostThread : SoftDeletableEntity
{
    public Guid PostId { get; set; }
    public Guid AuthorUserId { get; set; }
    public string Body { get; set; } = string.Empty;

    public Post? Post { get; set; }
    public User? AuthorUser { get; set; }
}
