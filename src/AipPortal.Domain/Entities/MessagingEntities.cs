using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Conversation : AuditableEntity
{
    public Guid WorkspaceId { get; set; }
    public ConversationType Type { get; set; } = ConversationType.Direct;

    public Workspace? Workspace { get; set; }
    public ICollection<ConversationMember> Members { get; } = new List<ConversationMember>();
    public ICollection<Message> Messages { get; } = new List<Message>();
}

public sealed class ConversationMember : AuditableEntity
{
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset JoinedAt { get; set; }
    public Guid? LastReadMessageId { get; set; }

    public Conversation? Conversation { get; set; }
    public User? User { get; set; }
    public Message? LastReadMessage { get; set; }
}

public sealed class Message : SoftDeletableEntity
{
    public Guid ConversationId { get; set; }
    public Guid AuthorUserId { get; set; }
    public string Body { get; set; } = string.Empty;

    public Conversation? Conversation { get; set; }
    public User? AuthorUser { get; set; }
}

public sealed class ReadState : AuditableEntity
{
    public Guid UserId { get; set; }
    public ReadScopeType ScopeType { get; set; }
    public Guid ScopeId { get; set; }
    public Guid? LastReadItemId { get; set; }
    public DateTimeOffset LastReadAt { get; set; }

    public User? User { get; set; }
}
