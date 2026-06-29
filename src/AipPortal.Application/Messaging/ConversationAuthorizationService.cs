using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Messaging;

public sealed class ConversationAuthorizationService(IMessagingRepository messaging) : IConversationAuthorizationService
{
    public async Task<bool> CanViewConversation(Guid userId, Guid conversationId, CancellationToken cancellationToken = default)
    {
        return await messaging.GetMemberAsync(conversationId, userId, cancellationToken) is { LeftAt: null };
    }

    public Task<bool> CanSendMessage(Guid userId, Guid conversationId, CancellationToken cancellationToken = default)
    {
        return CanViewConversation(userId, conversationId, cancellationToken);
    }

    public async Task<bool> CanManageConversation(Guid userId, Guid conversationId, CancellationToken cancellationToken = default)
    {
        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation?.Type == ConversationType.Direct)
        {
            return false;
        }

        return await messaging.GetMemberAsync(conversationId, userId, cancellationToken) is { LeftAt: null, Role: ConversationMemberRole.Admin };
    }

    public async Task<bool> CanEditMessage(Guid userId, Guid messageId, CancellationToken cancellationToken = default)
    {
        var message = await messaging.GetMessageAsync(messageId, cancellationToken);
        return message is not null &&
            message.AuthorUserId == userId &&
            !message.DeletedAt.HasValue &&
            await CanViewConversation(userId, message.ConversationId, cancellationToken);
    }

    public async Task<bool> CanDeleteMessage(Guid userId, Guid messageId, CancellationToken cancellationToken = default)
    {
        var message = await messaging.GetMessageAsync(messageId, cancellationToken);
        return message is not null &&
            !message.DeletedAt.HasValue &&
            ((message.AuthorUserId == userId && await CanViewConversation(userId, message.ConversationId, cancellationToken)) ||
            await CanManageConversation(userId, message.ConversationId, cancellationToken));
    }
}
