using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Messaging;

public sealed class ConversationService(
    IMessagingRepository messaging,
    IUserRepository users,
    IWorkspaceRepository workspaces,
    IProjectRepository projects,
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
            var member = await messaging.GetMemberAsync(conversation.Id, userId, cancellationToken);
            result.Add(new ConversationListItemResponse(
                conversation.Id,
                conversation.WorkspaceId,
                conversation.ProjectId,
                conversation.Type,
                conversation.Title,
                conversation.ParentConversationId,
                conversation.RootConversationId,
                last is null ? null : ToMessage(last),
                unread,
                member?.IsMuted ?? false,
                member?.IsArchived ?? false,
                conversation.CreatedAt,
                conversation.UpdatedAt));
        }
        return Result<PagedResponse<ConversationListItemResponse>>.Success(new PagedResponse<ConversationListItemResponse>(result, conversations.Page, conversations.PageSize, conversations.TotalCount));
    }

    public async Task<Result<ConversationDetailResponse>> CreateAsync(CreateConversationRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ConversationDetailResponse>.Failure("Authentication is required.");

        if (!IsSupportedMvpType(request.Type))
        {
            return Result<ConversationDetailResponse>.Failure("Conversation type is not supported in MVP.");
        }

        if (request.Type == ConversationType.Thread)
        {
            return await CreateThreadAsync(request, userId, cancellationToken);
        }

        if (!request.WorkspaceId.HasValue || request.WorkspaceId.Value == Guid.Empty)
        {
            return Result<ConversationDetailResponse>.Failure("WorkspaceId is required.");
        }

        var workspace = await workspaces.GetByIdAsync(request.WorkspaceId.Value, cancellationToken);
        if (workspace is null || workspace.DeletedAt.HasValue || workspace.Status != WorkspaceStatus.Active)
        {
            return Result<ConversationDetailResponse>.Failure("Workspace not found.");
        }

        Project? project = null;
        if (request.Type == ConversationType.ProjectChannel)
        {
            if (!request.ProjectId.HasValue || request.ProjectId.Value == Guid.Empty)
            {
                return Result<ConversationDetailResponse>.Failure("ProjectChannel requires ProjectId.");
            }

            project = await projects.GetProjectAsync(request.ProjectId.Value, cancellationToken);
            if (project is null || project.DeletedAt.HasValue || project.WorkspaceId != request.WorkspaceId.Value)
            {
                return Result<ConversationDetailResponse>.Failure("Project must belong to the selected workspace.");
            }
        }
        else if (request.ProjectId.HasValue)
        {
            project = await projects.GetProjectAsync(request.ProjectId.Value, cancellationToken);
            if (project is null || project.DeletedAt.HasValue || project.WorkspaceId != request.WorkspaceId.Value)
            {
                return Result<ConversationDetailResponse>.Failure("Project must belong to the selected workspace.");
            }
        }

        var memberIds = request.MemberUserIds.Append(userId).Distinct().ToList();
        if (request.Type == ConversationType.DirectMessage)
        {
            if (memberIds.Count != 2) return Result<ConversationDetailResponse>.Failure("Direct conversations require exactly two members.");
            var existing = await messaging.FindDirectAsync(request.WorkspaceId.Value, memberIds[0], memberIds[1], cancellationToken);
            if (existing is not null) return Result<ConversationDetailResponse>.Success(await ToDetailAsync(existing, cancellationToken));
        }

        foreach (var memberId in memberIds)
        {
            if (await users.GetByIdAsync(memberId, cancellationToken) is null) return Result<ConversationDetailResponse>.Failure("Conversation member not found.");
        }

        var conversation = new Conversation
        {
            WorkspaceId = request.WorkspaceId.Value,
            ProjectId = project?.Id,
            Type = request.Type,
            Title = request.Type == ConversationType.DirectMessage ? null : request.Title?.Trim(),
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
                CanRead = true,
                CanPost = true,
                CanManageMembers = memberId == userId,
                CanCreateThread = true,
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
        if (conversation is null || conversation.Type == ConversationType.DirectMessage) return Result<ConversationDetailResponse>.Failure("Conversation not found.");
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
        if (conversation is null || conversation.Type == ConversationType.DirectMessage) return Result<ConversationMemberResponse>.Failure("Direct conversations cannot add extra members.");
        if (conversation.Type == ConversationType.Thread) return Result<ConversationMemberResponse>.Failure("Thread membership is inherited from the parent conversation.");
        var existingMember = await messaging.GetMemberAsync(conversationId, request.UserId, cancellationToken);
        if (IsActiveParticipant(existingMember)) return Result<ConversationMemberResponse>.Failure("User is already a conversation member.");
        var user = await users.GetByIdAsync(request.UserId, cancellationToken);
        if (user is null) return Result<ConversationMemberResponse>.Failure("User not found.");
        var member = existingMember ?? new ConversationMember { ConversationId = conversationId, UserId = request.UserId };
        member.User = user;
        member.Role = ConversationMemberRole.Member;
        member.CanRead = true;
        member.CanPost = true;
        member.CanManageMembers = false;
        member.CanCreateThread = true;
        member.JoinedAt = clock.UtcNow;
        member.LeftAt = null;
        member.RemovedAt = null;
        member.RemovedByUserId = null;
        if (existingMember is null)
        {
            await messaging.AddMemberAsync(member, cancellationToken);
        }
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
        member.RemovedAt = member.LeftAt;
        member.RemovedByUserId = userId;
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
        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null) return Result<MessageResponse>.Failure("Conversation not found.");
        foreach (var attachment in attachments)
        {
            var extension = Path.GetExtension(attachment.FileName).ToLowerInvariant();
            if (attachment.FileSize <= 0 || attachment.FileSize > MaxAttachmentBytes || !AllowedExtensions.Contains(extension)) return Result<MessageResponse>.Failure("Attachment is not allowed.");
        }
        var message = new Message { WorkspaceId = conversation.WorkspaceId, ConversationId = conversationId, AuthorUserId = userId, Body = request.Body?.Trim() ?? string.Empty };
        await messaging.AddMessageAsync(message, cancellationToken);
        foreach (var item in attachments)
        {
            var attachment = new Attachment { WorkspaceId = conversation.WorkspaceId, OwnerType = AttachmentOwnerType.Message, OwnerId = message.Id, OwnerUserId = userId, UploadedByUserId = userId, FileName = item.FileName, StoredFileName = item.StoredFileName, FilePath = item.FilePath, ContentType = item.ContentType, Extension = Path.GetExtension(item.FileName), SizeBytes = item.FileSize, StorageProvider = "metadata-only", StorageKey = item.FilePath };
            await messaging.AddAttachmentAsync(attachment, new MessageAttachment { MessageId = message.Id, AttachmentId = attachment.Id }, cancellationToken);
            await AuditAsync(userId, "MessageAttachmentAdded", message.Id, cancellationToken);
        }
        var members = await messaging.ListMembersAsync(conversationId, cancellationToken);
        foreach (var member in members.Where(m => m.UserId != userId && IsActiveParticipant(m)))
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
            return await DenyAsync(userId, "ConversationReadDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken, "participant_missing");
        }

        if (!await ValidateReadableConversationMessageAsync(userId, conversationId, request.LastReadMessageId, "cursor_message_denied", cancellationToken))
        {
            return await DenyAsync(userId, "ConversationReadDenied", "Conversation", conversationId, "Message not found.", cancellationToken, "cursor_message_denied");
        }

        var member = await messaging.GetMemberAsync(conversationId, userId, cancellationToken);
        if (!IsActiveParticipant(member))
        {
            return await DenyAsync(userId, "ConversationReadDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken, "participant_removed");
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
        member!.LastReadMessageId = request.LastReadMessageId;
        member.LastReadAt = state.LastReadAt;
        member.UnreadCursorMessageId = null;
        await AuditParticipantStateAsync(userId, "mark_read", conversationId, "allow", "self_state_only", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<ParticipantStateResponse>> GetParticipantStateAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ParticipantStateResponse>.Failure("Conversation not found.");
        if (!await authorization.CanViewConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<ParticipantStateResponse>(userId, "ParticipantStateReadDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken, "self_state_only");
        }

        var member = await messaging.GetMemberAsync(conversationId, userId, cancellationToken);
        if (!IsActiveParticipant(member))
        {
            return await DenyAsync<ParticipantStateResponse>(userId, "ParticipantStateReadDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken, "participant_removed");
        }

        return Result<ParticipantStateResponse>.Success(await ToParticipantStateAsync(member!, userId, cancellationToken));
    }

    public async Task<Result<ParticipantStateResponse>> UpdateParticipantStateAsync(Guid conversationId, UpdateParticipantStateRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ParticipantStateResponse>.Failure("Conversation not found.");
        if (!await authorization.CanViewConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<ParticipantStateResponse>(userId, "ParticipantStateUpdateDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken, "self_state_only");
        }

        var member = await messaging.GetMemberAsync(conversationId, userId, cancellationToken);
        if (!IsActiveParticipant(member))
        {
            return await DenyAsync<ParticipantStateResponse>(userId, "ParticipantStateUpdateDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken, "participant_removed");
        }

        if (!await ValidateReadableConversationMessageAsync(userId, conversationId, request.LastReadMessageId, "cursor_message_denied", cancellationToken) ||
            !await ValidateReadableConversationMessageAsync(userId, conversationId, request.UnreadCursorMessageId, "cursor_message_denied", cancellationToken))
        {
            return await DenyAsync<ParticipantStateResponse>(userId, "ParticipantStateUpdateDenied", "Conversation", conversationId, "Message not found.", cancellationToken, "cursor_message_denied");
        }

        var now = clock.UtcNow;
        member!.LastOpenedAt = request.LastOpenedAt ?? now;
        if (request.LastReadMessageId.HasValue)
        {
            member.LastReadMessageId = request.LastReadMessageId;
            member.LastReadAt = now;
            var state = await messaging.GetReadStateAsync(conversationId, userId, cancellationToken);
            if (state is null)
            {
                state = new ReadState { UserId = userId, ScopeType = ReadScopeType.Conversation, ScopeId = conversationId, ConversationId = conversationId };
                await messaging.AddReadStateAsync(state, cancellationToken);
            }

            state.LastReadMessageId = request.LastReadMessageId;
            state.LastReadItemId = request.LastReadMessageId;
            state.LastReadAt = now;
        }

        if (request.UnreadCursorMessageId.HasValue)
        {
            member.UnreadCursorMessageId = request.UnreadCursorMessageId;
        }

        if (request.IsMuted.HasValue)
        {
            member.IsMuted = request.IsMuted.Value;
        }

        if (request.IsArchived.HasValue)
        {
            member.IsArchived = request.IsArchived.Value;
        }

        await AuditParticipantStateAsync(userId, "update_participant_state", conversationId, "allow", "self_state_only", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ParticipantStateResponse>.Success(await ToParticipantStateAsync(member, userId, cancellationToken));
    }

    private bool TryCurrentUser(out Guid userId) { userId = currentUser.UserId ?? Guid.Empty; return currentUser.IsAuthenticated && currentUser.UserId.HasValue; }
    private static bool IsSupportedMvpType(ConversationType type) => type is ConversationType.DirectMessage or ConversationType.ProjectChannel or ConversationType.Thread;

    private async Task<Result<ConversationDetailResponse>> CreateThreadAsync(CreateConversationRequest request, Guid userId, CancellationToken cancellationToken)
    {
        if (!request.ParentConversationId.HasValue || request.ParentConversationId.Value == Guid.Empty)
        {
            return Result<ConversationDetailResponse>.Failure("Thread conversations require ParentConversationId.");
        }

        var parent = await messaging.GetConversationAsync(request.ParentConversationId.Value, cancellationToken);
        if (parent is null || parent.Type == ConversationType.Thread && parent.ParentConversationId is null)
        {
            return Result<ConversationDetailResponse>.Failure("Parent conversation not found.");
        }

        if (parent.IsArchived || parent.IsLocked)
        {
            return Result<ConversationDetailResponse>.Failure("Parent conversation cannot accept threads.");
        }

        if (!await authorization.CanCreateThread(userId, parent.Id, cancellationToken))
        {
            return await DenyAsync<ConversationDetailResponse>(userId, "ConversationThreadCreateDenied", "Conversation", parent.Id, "Parent conversation not found.", cancellationToken, "participant_thread_create_denied");
        }

        if (request.WorkspaceId.HasValue && request.WorkspaceId.Value != parent.WorkspaceId)
        {
            return Result<ConversationDetailResponse>.Failure("Thread workspace scope must match parent conversation.");
        }

        if (request.ProjectId.HasValue && request.ProjectId != parent.ProjectId)
        {
            return Result<ConversationDetailResponse>.Failure("Thread project scope must match parent conversation.");
        }

        var parentMembers = (await messaging.ListMembersAsync(parent.Id, cancellationToken))
            .Where(IsActiveParticipant)
            .ToList();
        var requestedMembers = request.MemberUserIds.Distinct().ToList();
        if (requestedMembers.Any(memberId => parentMembers.All(parentMember => parentMember.UserId != memberId)))
        {
            return Result<ConversationDetailResponse>.Failure("Thread membership must stay within the parent conversation.");
        }

        var conversation = new Conversation
        {
            WorkspaceId = parent.WorkspaceId,
            ProjectId = parent.ProjectId,
            Type = ConversationType.Thread,
            Title = request.Title?.Trim(),
            ParentConversationId = parent.Id,
            RootConversationId = parent.RootConversationId ?? parent.Id,
            CreatedByUserId = userId
        };
        await messaging.AddConversationAsync(conversation, cancellationToken);
        foreach (var parentMember in parentMembers)
        {
            await messaging.AddMemberAsync(new ConversationMember
            {
                ConversationId = conversation.Id,
                UserId = parentMember.UserId,
                Role = parentMember.Role,
                CanRead = parentMember.CanRead,
                CanPost = parentMember.CanPost,
                CanManageMembers = false,
                CanCreateThread = parentMember.CanCreateThread,
                JoinedAt = clock.UtcNow
            }, cancellationToken);
        }

        await AuditAsync(userId, "ConversationThreadCreated", conversation.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ConversationDetailResponse>.Success(await ToDetailAsync(conversation, cancellationToken));
    }

    private Task AuditAsync(Guid actorUserId, string action, Guid targetId, CancellationToken cancellationToken) => auditLogger.LogAsync(new AuditLogEntry(actorUserId, action, "Message", targetId), cancellationToken);
    private Task AuditParticipantStateAsync(Guid actorUserId, string operation, Guid conversationId, string decision, string reasonCode, CancellationToken cancellationToken)
    {
        return auditLogger.LogAsync(new AuditLogEntry(
            actorUserId,
            operation == "mark_read" ? "ConversationMarkedRead" : "ParticipantStateUpdated",
            "Conversation",
            conversationId,
            "Conversation participant state updated.",
            Metadata: new Dictionary<string, object?>
            {
                ["operation"] = operation,
                ["decision"] = decision,
                ["reasonCode"] = reasonCode
            }),
            cancellationToken);
    }

    private async Task<Result<T>> DenyAsync<T>(Guid actorUserId, string action, string entityType, Guid entityId, string error, CancellationToken cancellationToken, string? reasonCode = null)
    {
        await auditLogger.LogAsync(new AuditLogEntry(
            actorUserId,
            action,
            entityType,
            entityId,
            "Conversation access denied.",
            Metadata: await BuildDenialMetadataAsync(actorUserId, action, entityType, entityId, reasonCode, cancellationToken)),
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<T>.Failure(error);
    }
    private async Task<Result> DenyAsync(Guid actorUserId, string action, string entityType, Guid entityId, string error, CancellationToken cancellationToken, string? reasonCode = null)
    {
        await auditLogger.LogAsync(new AuditLogEntry(
            actorUserId,
            action,
            entityType,
            entityId,
            "Conversation access denied.",
            Metadata: await BuildDenialMetadataAsync(actorUserId, action, entityType, entityId, reasonCode, cancellationToken)),
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Failure(error);
    }

    private async Task<ConversationDetailResponse> ToDetailAsync(Conversation conversation, CancellationToken cancellationToken) => new(
        conversation.Id,
        conversation.WorkspaceId,
        conversation.ProjectId,
        conversation.Type,
        conversation.Title,
        conversation.ParentConversationId,
        conversation.RootConversationId,
        conversation.IsArchived,
        conversation.IsLocked,
        (await messaging.ListMembersAsync(conversation.Id, cancellationToken)).Select(ToMember).ToList(),
        conversation.CreatedAt,
        conversation.UpdatedAt);

    private async Task<ParticipantStateResponse> ToParticipantStateAsync(ConversationMember member, Guid actorUserId, CancellationToken cancellationToken)
    {
        var unread = await messaging.CountUnreadMessagesAsync(member.ConversationId, actorUserId, member.LastReadAt, cancellationToken);
        return new ParticipantStateResponse(
            member.Id,
            member.UserId,
            member.ConversationId,
            member.LastOpenedAt,
            member.LastReadMessageId,
            member.LastReadAt,
            member.UnreadCursorMessageId,
            unread,
            member.IsMuted,
            member.IsArchived,
            member.CreatedAt,
            member.UpdatedAt);
    }

    private async Task<bool> ValidateReadableConversationMessageAsync(Guid actorUserId, Guid conversationId, Guid? messageId, string reasonCode, CancellationToken cancellationToken)
    {
        if (!messageId.HasValue)
        {
            return true;
        }

        var message = await messaging.GetMessageAsync(messageId.Value, cancellationToken);
        return message is not null &&
            message.ConversationId == conversationId &&
            !message.DeletedAt.HasValue &&
            await authorization.CanViewConversation(actorUserId, message.ConversationId, cancellationToken);
    }

    private async Task<IReadOnlyDictionary<string, object?>> BuildDenialMetadataAsync(Guid actorUserId, string action, string entityType, Guid entityId, string? reasonCode, CancellationToken cancellationToken)
    {
        return new Dictionary<string, object?>
        {
            ["targetOperation"] = action,
            ["decision"] = "deny",
            ["reasonCode"] = reasonCode ?? DefaultReasonCode(action),
            ["participantState"] = entityType == "Conversation"
                ? await GetParticipantStateAsync(entityId, actorUserId, cancellationToken)
                : "unknown"
        };
    }

    private async Task<string> GetParticipantStateAsync(Guid conversationId, Guid actorUserId, CancellationToken cancellationToken)
    {
        var member = await messaging.GetMemberAsync(conversationId, actorUserId, cancellationToken);
        if (member is null)
        {
            return "missing";
        }

        return IsActiveParticipant(member) ? "active" : "removed";
    }

    private static string DefaultReasonCode(string action)
    {
        return action switch
        {
            "ConversationAccessDenied" or "ConversationReadDenied" => "participant_read_denied",
            "ParticipantStateReadDenied" => "self_state_only",
            "ParticipantStateUpdateDenied" => "state_update_denied",
            "MessageSendDenied" => "participant_post_denied",
            "ConversationManageDenied" => "participant_manage_members_denied",
            "ConversationThreadCreateDenied" => "participant_thread_create_denied",
            _ => "participant_missing"
        };
    }

    private static bool IsActiveParticipant(ConversationMember? member)
    {
        return member is { LeftAt: null, RemovedAt: null, CanRead: true };
    }

    private static ConversationMemberResponse ToMember(ConversationMember member) => new(
        member.UserId,
        member.User?.DisplayName ?? string.Empty,
        member.User?.Email ?? string.Empty,
        member.Role,
        member.CanRead,
        member.CanPost,
        member.CanManageMembers,
        member.CanCreateThread,
        member.JoinedAt,
        member.LeftAt,
        member.RemovedAt);
    private static MessageResponse ToMessage(Message message) => new(message.Id, message.WorkspaceId, message.ConversationId, message.AuthorUserId, message.AuthorUser?.DisplayName ?? string.Empty, message.DeletedAt.HasValue ? string.Empty : message.Body, message.Attachments.Select(a => new AttachmentResponse(a.AttachmentId, a.Attachment?.FileName ?? string.Empty, a.Attachment?.ContentType ?? string.Empty, a.Attachment?.SizeBytes ?? 0)).ToList(), message.CreatedAt, message.UpdatedAt, message.EditedAt, message.DeletedAt.HasValue);
}
