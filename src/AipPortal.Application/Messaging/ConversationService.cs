using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Messaging;

public sealed class ConversationService(
    IMessagingRepository messaging,
    IUserRepository users,
    IConversationAuthorizationService authorization,
    ICurrentUser currentUser,
    IClock clock,
    IAuditLogger auditLogger,
    INotificationService notifications,
    IUnitOfWork unitOfWork) : IConversationService
{
    private const long MaxAttachmentBytes = 25 * 1024 * 1024;
    private static readonly HashSet<string> AllowedExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".txt", ".docx", ".xlsx", ".pptx", ".zip"];

    public async Task<Result<PagedResponse<ConversationListItemResponse>>> ListAsync(ConversationListQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<PagedResponse<ConversationListItemResponse>>.Failure("Authentication is required.");
        var conversations = await messaging.ListForUserAsync(userId, query.SafePage, query.SafePageSize, cancellationToken);
        var result = new List<ConversationListItemResponse>();
        foreach (var conversation in conversations.Items)
        {
            var page = await messaging.ListMessagesAsync(conversation.Id, 1, null, cancellationToken);
            var last = page.Items.FirstOrDefault();
            var read = await messaging.GetReadStateAsync(conversation.Id, userId, cancellationToken);
            var unread = await messaging.CountUnreadMessagesAsync(conversation.Id, userId, read?.LastReadAt, cancellationToken);
            result.Add(new ConversationListItemResponse(conversation.Id, conversation.Type, conversation.Title, last is null ? null : ToMessage(last), unread, conversation.CreatedAt, conversation.UpdatedAt));
        }
        return Result<PagedResponse<ConversationListItemResponse>>.Success(new PagedResponse<ConversationListItemResponse>(result, conversations.Page, conversations.PageSize, conversations.TotalCount));
    }

    public async Task<Result<ConversationDetailResponse>> CreateAsync(CreateConversationRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ConversationDetailResponse>.Failure("Authentication is required.");
        var memberIds = request.MemberUserIds.Append(userId).Distinct().ToList();
        if (request.Type == ConversationType.Direct)
        {
            if (memberIds.Count != 2) return Result<ConversationDetailResponse>.Failure("Direct conversations require exactly two members.");
            var existing = await messaging.FindDirectAsync(memberIds[0], memberIds[1], cancellationToken);
            if (existing is not null) return Result<ConversationDetailResponse>.Success(await ToDetailAsync(existing, cancellationToken));
        }
        else if (request.Type == ConversationType.Group && memberIds.Count < 2)
        {
            return Result<ConversationDetailResponse>.Failure("Group conversations require at least two members.");
        }

        foreach (var memberId in memberIds)
        {
            if (await users.GetByIdAsync(memberId, cancellationToken) is null) return Result<ConversationDetailResponse>.Failure("Conversation member not found.");
        }

        var conversation = new Conversation
        {
            WorkspaceId = Guid.Empty,
            Type = request.Type,
            Title = request.Type == ConversationType.Direct ? null : request.Title?.Trim(),
            CreatedByUserId = userId
        };
        await messaging.AddConversationAsync(conversation, cancellationToken);
        foreach (var memberId in memberIds)
        {
            await messaging.AddMemberAsync(new ConversationMember
            {
                ConversationId = conversation.Id,
                UserId = memberId,
                Role = memberId == userId ? ConversationMemberRole.Admin : ConversationMemberRole.Member,
                JoinedAt = clock.UtcNow
            }, cancellationToken);
        }
        await AuditAsync(userId, "ConversationCreated", conversation.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ConversationDetailResponse>.Success(await ToDetailAsync(conversation, cancellationToken));
    }

    public async Task<Result<ConversationDetailResponse>> GetAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ConversationDetailResponse>.Failure("Conversation not found.");
        if (!await authorization.CanViewConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<ConversationDetailResponse>(userId, "ConversationAccessDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken);
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        return conversation is null ? Result<ConversationDetailResponse>.Failure("Conversation not found.") : Result<ConversationDetailResponse>.Success(await ToDetailAsync(conversation, cancellationToken));
    }

    public async Task<Result<ConversationDetailResponse>> UpdateAsync(Guid conversationId, UpdateConversationRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ConversationDetailResponse>.Failure("You are not allowed to manage this conversation.");
        if (!await authorization.CanManageConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<ConversationDetailResponse>(userId, "ConversationManageDenied", "Conversation", conversationId, "You are not allowed to manage this conversation.", cancellationToken);
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null || conversation.Type == ConversationType.Direct) return Result<ConversationDetailResponse>.Failure("Conversation not found.");
        conversation.Title = request.Title?.Trim();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ConversationDetailResponse>.Success(await ToDetailAsync(conversation, cancellationToken));
    }

    public async Task<Result> LeaveAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result.Failure("Authentication is required.");
        var member = await messaging.GetMemberAsync(conversationId, userId, cancellationToken);
        if (member is null) return Result.Failure("Conversation not found.");
        member.LeftAt = clock.UtcNow;
        await AuditAsync(userId, "ConversationMemberLeft", conversationId, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<ConversationMemberResponse>>> ListMembersAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<IReadOnlyList<ConversationMemberResponse>>.Failure("Conversation not found.");
        if (!await authorization.CanViewConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<IReadOnlyList<ConversationMemberResponse>>(userId, "ConversationAccessDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken);
        }

        var members = await messaging.ListMembersAsync(conversationId, cancellationToken);
        return Result<IReadOnlyList<ConversationMemberResponse>>.Success(members.Select(ToMember).ToList());
    }

    public async Task<Result<ConversationMemberResponse>> AddMemberAsync(Guid conversationId, AddConversationMemberRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ConversationMemberResponse>.Failure("You are not allowed to manage this conversation.");
        if (!await authorization.CanManageConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<ConversationMemberResponse>(userId, "ConversationManageDenied", "Conversation", conversationId, "You are not allowed to manage this conversation.", cancellationToken);
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null || conversation.Type == ConversationType.Direct) return Result<ConversationMemberResponse>.Failure("Direct conversations cannot add extra members.");
        if (await messaging.GetMemberAsync(conversationId, request.UserId, cancellationToken) is not null) return Result<ConversationMemberResponse>.Failure("User is already a conversation member.");
        var user = await users.GetByIdAsync(request.UserId, cancellationToken);
        if (user is null) return Result<ConversationMemberResponse>.Failure("User not found.");
        var member = new ConversationMember { ConversationId = conversationId, UserId = request.UserId, User = user, Role = ConversationMemberRole.Member, JoinedAt = clock.UtcNow };
        await messaging.AddMemberAsync(member, cancellationToken);
        await AuditAsync(userId, "ConversationMemberAdded", conversationId, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ConversationMemberResponse>.Success(ToMember(member));
    }

    public async Task<Result> RemoveMemberAsync(Guid conversationId, Guid removeUserId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result.Failure("You are not allowed to manage this conversation.");
        if (!await authorization.CanManageConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync(userId, "ConversationManageDenied", "Conversation", conversationId, "You are not allowed to manage this conversation.", cancellationToken);
        }

        var member = await messaging.GetMemberAsync(conversationId, removeUserId, cancellationToken);
        if (member is null) return Result.Failure("Conversation member not found.");
        member.LeftAt = clock.UtcNow;
        await AuditAsync(userId, "ConversationMemberRemoved", conversationId, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<PagedResponse<MessageResponse>>> ListMessagesAsync(Guid conversationId, MessageListQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<PagedResponse<MessageResponse>>.Failure("Conversation not found.");
        if (!await authorization.CanViewConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<PagedResponse<MessageResponse>>(userId, "ConversationAccessDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken);
        }

        var page = await messaging.ListMessagesAsync(conversationId, query.SafeLimit, query.Before, cancellationToken);
        return Result<PagedResponse<MessageResponse>>.Success(new PagedResponse<MessageResponse>(page.Items.Select(ToMessage).ToList(), 1, query.SafeLimit, page.TotalCount));
    }

    public async Task<Result<MessageResponse>> SendMessageAsync(Guid conversationId, SendMessageRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<MessageResponse>.Failure("You are not allowed to send messages.");
        if (!await authorization.CanSendMessage(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<MessageResponse>(userId, "MessageSendDenied", "Conversation", conversationId, "You are not allowed to send messages.", cancellationToken);
        }

        var attachments = request.Attachments ?? [];
        if (string.IsNullOrWhiteSpace(request.Body) && attachments.Count == 0) return Result<MessageResponse>.Failure("Message body or attachment is required.");
        foreach (var attachment in attachments)
        {
            var extension = Path.GetExtension(attachment.FileName).ToLowerInvariant();
            if (attachment.FileSize <= 0 || attachment.FileSize > MaxAttachmentBytes || !AllowedExtensions.Contains(extension)) return Result<MessageResponse>.Failure("Attachment is not allowed.");
        }
        var message = new Message { ConversationId = conversationId, AuthorUserId = userId, Body = request.Body?.Trim() ?? string.Empty };
        await messaging.AddMessageAsync(message, cancellationToken);
        foreach (var item in attachments)
        {
            var attachment = new Attachment { WorkspaceId = Guid.Empty, OwnerType = AttachmentOwnerType.Message, OwnerId = message.Id, OwnerUserId = userId, UploadedByUserId = userId, FileName = item.FileName, StoredFileName = item.StoredFileName, FilePath = item.FilePath, ContentType = item.ContentType, Extension = Path.GetExtension(item.FileName), SizeBytes = item.FileSize, StorageProvider = "metadata-only", StorageKey = item.FilePath };
            await messaging.AddAttachmentAsync(attachment, new MessageAttachment { MessageId = message.Id, AttachmentId = attachment.Id }, cancellationToken);
            await AuditAsync(userId, "MessageAttachmentAdded", message.Id, cancellationToken);
        }
        var members = await messaging.ListMembersAsync(conversationId, cancellationToken);
        foreach (var member in members.Where(m => m.UserId != userId && m.LeftAt is null))
        {
            await notifications.NotifyAsync(member.UserId, "New direct message", "You have a new message.", "Message", message.Id, cancellationToken);
        }
        await AuditAsync(userId, "MessageSent", message.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        message.AuthorUser = await users.GetByIdAsync(userId, cancellationToken);
        return Result<MessageResponse>.Success(ToMessage(message));
    }

    public async Task<Result<MessageResponse>> UpdateMessageAsync(Guid messageId, UpdateMessageRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<MessageResponse>.Failure("You are not allowed to edit this message.");
        if (!await authorization.CanEditMessage(userId, messageId, cancellationToken))
        {
            return await DenyAsync<MessageResponse>(userId, "MessageEditDenied", "Message", messageId, "You are not allowed to edit this message.", cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(request.Body)) return Result<MessageResponse>.Failure("Message body is required.");
        var message = await messaging.GetMessageAsync(messageId, cancellationToken);
        message!.Body = request.Body.Trim();
        message.EditedAt = clock.UtcNow;
        await AuditAsync(userId, "MessageEdited", message.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<MessageResponse>.Success(ToMessage(message));
    }

    public async Task<Result> DeleteMessageAsync(Guid messageId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result.Failure("You are not allowed to delete this message.");
        if (!await authorization.CanDeleteMessage(userId, messageId, cancellationToken))
        {
            return await DenyAsync(userId, "MessageDeleteDenied", "Message", messageId, "You are not allowed to delete this message.", cancellationToken);
        }

        var message = await messaging.GetMessageAsync(messageId, cancellationToken);
        message!.MarkDeleted(clock.UtcNow);
        await AuditAsync(userId, "MessageDeleted", message.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> MarkReadAsync(Guid conversationId, MarkConversationReadRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result.Failure("Conversation not found.");
        if (!await authorization.CanViewConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync(userId, "ConversationReadDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken);
        }

        if (request.LastReadMessageId.HasValue)
        {
            var lastReadMessage = await messaging.GetMessageAsync(request.LastReadMessageId.Value, cancellationToken);
            if (lastReadMessage is null || lastReadMessage.ConversationId != conversationId || lastReadMessage.DeletedAt.HasValue)
            {
                return Result.Failure("Message not found.");
            }
        }

        var state = await messaging.GetReadStateAsync(conversationId, userId, cancellationToken);
        if (state is null)
        {
            state = new ReadState { UserId = userId, ScopeType = ReadScopeType.Conversation, ScopeId = conversationId, ConversationId = conversationId };
            await messaging.AddReadStateAsync(state, cancellationToken);
        }
        state.LastReadMessageId = request.LastReadMessageId;
        state.LastReadItemId = request.LastReadMessageId;
        state.LastReadAt = clock.UtcNow;
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private bool TryCurrentUser(out Guid userId) { userId = currentUser.UserId ?? Guid.Empty; return currentUser.IsAuthenticated && currentUser.UserId.HasValue; }
    private Task AuditAsync(Guid actorUserId, string action, Guid targetId, CancellationToken cancellationToken) => auditLogger.LogAsync(new AuditLogEntry(actorUserId, action, "Message", targetId), cancellationToken);
    private async Task<Result<T>> DenyAsync<T>(Guid actorUserId, string action, string entityType, Guid entityId, string error, CancellationToken cancellationToken)
    {
        await auditLogger.LogAsync(new AuditLogEntry(actorUserId, action, entityType, entityId, "Conversation access denied."), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<T>.Failure(error);
    }
    private async Task<Result> DenyAsync(Guid actorUserId, string action, string entityType, Guid entityId, string error, CancellationToken cancellationToken)
    {
        await auditLogger.LogAsync(new AuditLogEntry(actorUserId, action, entityType, entityId, "Conversation access denied."), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Failure(error);
    }
    private async Task<ConversationDetailResponse> ToDetailAsync(Conversation conversation, CancellationToken cancellationToken) => new(conversation.Id, conversation.Type, conversation.Title, (await messaging.ListMembersAsync(conversation.Id, cancellationToken)).Select(ToMember).ToList(), conversation.CreatedAt, conversation.UpdatedAt);
    private static ConversationMemberResponse ToMember(ConversationMember member) => new(member.UserId, member.User?.DisplayName ?? string.Empty, member.User?.Email ?? string.Empty, member.Role, member.JoinedAt, member.LeftAt);
    private static MessageResponse ToMessage(Message message) => new(message.Id, message.ConversationId, message.AuthorUserId, message.AuthorUser?.DisplayName ?? string.Empty, message.DeletedAt.HasValue ? string.Empty : message.Body, message.Attachments.Select(a => new AttachmentResponse(a.AttachmentId, a.Attachment?.FileName ?? string.Empty, a.Attachment?.ContentType ?? string.Empty, a.Attachment?.SizeBytes ?? 0)).ToList(), message.CreatedAt, message.UpdatedAt, message.EditedAt, message.DeletedAt.HasValue);
}
