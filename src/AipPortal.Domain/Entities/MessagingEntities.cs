using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Conversation : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public ConversationType Type { get; set; } = ConversationType.Direct;
    public string? Title { get; set; }
    public Guid CreatedByUserId { get; set; }

    public Workspace? Workspace { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<ConversationMember> Members { get; } = new List<ConversationMember>();
    public ICollection<Message> Messages { get; } = new List<Message>();
}

public sealed class ConversationMember : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    public ConversationMemberRole Role { get; set; } = ConversationMemberRole.Member;
    public DateTimeOffset JoinedAt { get; set; }
    public DateTimeOffset? LeftAt { get; set; }
    public Guid? LastReadMessageId { get; set; }

    public Conversation? Conversation { get; set; }
    public User? User { get; set; }
    public Message? LastReadMessage { get; set; }
}

public sealed class Message : SoftDeletableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid ConversationId { get; set; }
    public Guid AuthorUserId { get; set; }
    public string Body { get; set; } = string.Empty;
    public DateTimeOffset? EditedAt { get; set; }

    public Conversation? Conversation { get; set; }
    public User? AuthorUser { get; set; }
    public ICollection<MessageAttachment> Attachments { get; } = new List<MessageAttachment>();
}

public sealed class ReadState : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public ReadScopeType ScopeType { get; set; }
    public Guid ScopeId { get; set; }
    public Guid? LastReadItemId { get; set; }
    public Guid? ConversationId { get; set; }
    public Guid? LastReadMessageId { get; set; }
    public DateTimeOffset LastReadAt { get; set; }

    public User? User { get; set; }
    public Conversation? Conversation { get; set; }
    public Message? LastReadMessage { get; set; }
}

public sealed class MessageAttachment : Entity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid MessageId { get; set; }
    public Guid AttachmentId { get; set; }

    public Message? Message { get; set; }
    public Attachment? Attachment { get; set; }
}
