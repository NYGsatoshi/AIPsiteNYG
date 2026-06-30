using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Messaging;

public sealed class ConversationAuthorizationService(IMessagingRepository messaging, IProjectAuthorizationService projects) : IConversationAuthorizationService
{
    public Task<bool> CanViewConversation(Guid userId, Guid conversationId, CancellationToken cancellationToken = default)
    {
        return CanViewConversationCore(userId, conversationId, [], cancellationToken);
    }

    public Task<bool> CanSendMessage(Guid userId, Guid conversationId, CancellationToken cancellationToken = default)
    {
        return CanSendMessageCore(userId, conversationId, [], cancellationToken);
    }

    public async Task<bool> CanManageConversation(Guid userId, Guid conversationId, CancellationToken cancellationToken = default)
    {
        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null ||
            !IsSupportedMvpType(conversation.Type) ||
            conversation.Type is ConversationType.DirectMessage or ConversationType.Thread ||
            !await IsConversationScopeAllowed(userId, conversation, cancellationToken))
        {
            return false;
        }

        var member = await messaging.GetMemberAsync(conversationId, userId, cancellationToken);
        return member is not null &&
            IsActiveParticipant(member) &&
            (member.Role == ConversationMemberRole.Admin || member.CanManageMembers);
    }

    public async Task<bool> CanCreateThread(Guid userId, Guid parentConversationId, CancellationToken cancellationToken = default)
    {
        var parent = await messaging.GetConversationAsync(parentConversationId, cancellationToken);
        if (parent is null ||
            !IsSupportedMvpType(parent.Type) ||
            parent.IsArchived ||
            parent.IsLocked ||
            !await IsConversationScopeAllowed(userId, parent, cancellationToken))
        {
            return false;
        }

        var member = await messaging.GetMemberAsync(parentConversationId, userId, cancellationToken);
        return member is not null &&
            IsActiveParticipant(member) &&
            member.CanPost &&
            member.CanCreateThread &&
            member.Role != ConversationMemberRole.ReadOnly &&
            (parent.Type != ConversationType.Thread || await CanCreateThread(userId, parent.ParentConversationId ?? Guid.Empty, cancellationToken));
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

    private async Task<bool> CanViewConversationCore(Guid userId, Guid conversationId, HashSet<Guid> visited, CancellationToken cancellationToken)
    {
        if (conversationId == Guid.Empty || !visited.Add(conversationId))
        {
            return false;
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null ||
            !IsSupportedMvpType(conversation.Type) ||
            !await IsConversationScopeAllowed(userId, conversation, cancellationToken))
        {
            return false;
        }

        var member = await messaging.GetMemberAsync(conversationId, userId, cancellationToken);
        if (!IsActiveParticipant(member))
        {
            return false;
        }

        return conversation.Type != ConversationType.Thread ||
            await CanViewConversationCore(userId, conversation.ParentConversationId ?? Guid.Empty, visited, cancellationToken);
    }

    private async Task<bool> CanSendMessageCore(Guid userId, Guid conversationId, HashSet<Guid> visited, CancellationToken cancellationToken)
    {
        if (conversationId == Guid.Empty || !visited.Add(conversationId))
        {
            return false;
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null ||
            !IsSupportedMvpType(conversation.Type) ||
            conversation.IsArchived ||
            conversation.IsLocked ||
            !await IsConversationScopeAllowed(userId, conversation, cancellationToken))
        {
            return false;
        }

        var member = await messaging.GetMemberAsync(conversationId, userId, cancellationToken);
        if (member is null ||
            !IsActiveParticipant(member) ||
            !member.CanPost ||
            member.Role == ConversationMemberRole.ReadOnly)
        {
            return false;
        }

        return conversation.Type != ConversationType.Thread ||
            await CanSendMessageCore(userId, conversation.ParentConversationId ?? Guid.Empty, visited, cancellationToken);
    }

    private async Task<bool> IsConversationScopeAllowed(Guid userId, Conversation conversation, CancellationToken cancellationToken)
    {
        return conversation.Type != ConversationType.ProjectChannel ||
            conversation.ProjectId.HasValue && await projects.CanViewProject(userId, conversation.ProjectId.Value, cancellationToken);
    }

    private static bool IsActiveParticipant(ConversationMember? member)
    {
        return member is { LeftAt: null, RemovedAt: null, CanRead: true };
    }

    private static bool IsSupportedMvpType(ConversationType type)
    {
        return type is ConversationType.DirectMessage or ConversationType.ProjectChannel or ConversationType.Thread;
    }
}
