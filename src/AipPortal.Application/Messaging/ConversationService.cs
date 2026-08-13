using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using System.Text.Json;

namespace AipPortal.Application.Messaging;

public sealed class ConversationService(
    IMessagingRepository messaging,
    IUserRepository users,
    IWorkspaceRepository workspaces,
    IProjectRepository projects,
    IProjectAuthorizationService projectAuthorization,
    IConversationAuthorizationService authorization,
    ICurrentUser currentUser,
    IClock clock,
    CommunicationSafetyOptions safetyOptions,
    ICommunicationSafetyGuard safetyGuard,
    IAuditLogger auditLogger,
    INotificationService notifications,
    ITransactionalOutbox outbox,
    ICurrentTenant currentTenant,
    IUnitOfWork unitOfWork) : IConversationService
{
    private const long MaxAttachmentBytes = 25 * 1024 * 1024;
    private static readonly HashSet<string> AllowedExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".txt", ".docx", ".xlsx", ".pptx", ".zip"];

    public async Task<Result<PagedResponse<ConversationListItemResponse>>> ListAsync(ConversationListQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<PagedResponse<ConversationListItemResponse>>.Failure("Authentication is required.");
        var conversations = await messaging.ListForUserAsync(userId, query.SafePage, query.SafePageSize, cancellationToken);
        var readableIds = await messaging.FilterReadableConversationIdsAsync(
            userId,
            conversations.Items.Select(conversation => conversation.Id).ToArray(),
            cancellationToken);
        var result = new List<ConversationListItemResponse>();
        foreach (var conversation in conversations.Items)
        {
            // Repository filtering recursively scopes paging/counts. This
            // batched check is the final current-authorization boundary
            // before any title or last-message content is mapped.
            if (!readableIds.Contains(conversation.Id))
            {
                continue;
            }

            var page = await messaging.ListMessagesAsync(conversation.Id, 1, null, cancellationToken);
            var last = page.Items.FirstOrDefault();
            var read = await messaging.GetReadStateAsync(conversation.Id, userId, cancellationToken);
            var unread = await messaging.CountUnreadMessagesAsync(conversation.Id, userId, read?.LastReadAt, cancellationToken);
            var member = await messaging.GetMemberAsync(conversation.Id, userId, cancellationToken);
            IReadOnlyList<ConversationMember> members = conversation.Type == ConversationType.DirectMessage
                ? await messaging.ListMembersAsync(conversation.Id, cancellationToken)
                : [];
            result.Add(new ConversationListItemResponse(
                conversation.Id,
                conversation.WorkspaceId,
                conversation.ProjectId,
                conversation.Type,
                ConversationTitleFor(conversation, members, userId),
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

    public async Task<Result<IReadOnlyList<ConversationRecipientResponse>>> ListRecipientsAsync(string? query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<IReadOnlyList<ConversationRecipientResponse>>.Failure("Authentication is required.");
        }

        var recipients = await messaging.SearchDirectRecipientsAsync(userId, query, 20, cancellationToken);
        return Result<IReadOnlyList<ConversationRecipientResponse>>.Success(
            recipients
                .Select(user => new ConversationRecipientResponse(user.Id, user.DisplayName))
                .ToList());
    }

    public async Task<Result<ConversationDetailResponse>> CreateDirectAsync(CreateDirectConversationRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<ConversationDetailResponse>.Failure("Authentication is required.");
        }

        if (request.RecipientUserId == Guid.Empty || request.RecipientUserId == userId)
        {
            return Result<ConversationDetailResponse>.Failure("Recipient user is not allowed.");
        }

        var existing = await messaging.FindDirectForUsersAsync(userId, request.RecipientUserId, cancellationToken);
        if (existing is not null)
        {
            if (!await authorization.CanViewConversation(userId, existing.Id, cancellationToken))
            {
                return Result<ConversationDetailResponse>.Failure("Conversation not found.");
            }

            return Result<ConversationDetailResponse>.Success(await ToDetailAsync(existing, cancellationToken, userId));
        }

        var sharedWorkspace = await messaging.FindSharedActiveWorkspaceAsync(userId, request.RecipientUserId, cancellationToken);
        var recipient = await users.GetByIdAsync(request.RecipientUserId, cancellationToken);
        if (recipient is null ||
            recipient.DeletedAt.HasValue ||
            recipient.Status != UserStatus.Active ||
            sharedWorkspace is null)
        {
            return Result<ConversationDetailResponse>.Failure("Recipient user not found.");
        }

        return await CreateAsync(new CreateConversationRequest(
            ConversationType.DirectMessage,
            null,
            [request.RecipientUserId],
            sharedWorkspace.Id), cancellationToken);
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

            if (!await CanBindConversationToProjectAsync(project, userId, cancellationToken))
            {
                return Result<ConversationDetailResponse>.Failure("Project not found.");
            }
        }
        else if (request.ProjectId.HasValue)
        {
            project = await projects.GetProjectAsync(request.ProjectId.Value, cancellationToken);
            if (project is null || project.DeletedAt.HasValue || project.WorkspaceId != request.WorkspaceId.Value)
            {
                return Result<ConversationDetailResponse>.Failure("Project must belong to the selected workspace.");
            }

            if (!await CanBindConversationToProjectAsync(project, userId, cancellationToken))
            {
                return Result<ConversationDetailResponse>.Failure("Project not found.");
            }
        }

        var memberIds = request.MemberUserIds.Append(userId).Distinct().ToList();
        if (request.Type == ConversationType.DirectMessage)
        {
            if (memberIds.Count != 2) return Result<ConversationDetailResponse>.Failure("Direct conversations require exactly two members.");
            var existing = await messaging.FindDirectAsync(
                request.WorkspaceId.Value,
                project?.Id,
                memberIds[0],
                memberIds[1],
                cancellationToken);
            if (existing is not null)
            {
                if (!await authorization.CanViewConversation(userId, existing.Id, cancellationToken))
                {
                    return Result<ConversationDetailResponse>.Failure("Conversation not found.");
                }

                return Result<ConversationDetailResponse>.Success(await ToDetailAsync(existing, cancellationToken, userId));
            }
        }

        foreach (var memberId in memberIds)
        {
            if (await users.GetByIdAsync(memberId, cancellationToken) is null)
            {
                return Result<ConversationDetailResponse>.Failure("Conversation member not found.");
            }
            if (project is not null &&
                !await projectAuthorization.CanViewProject(memberId, project.Id, cancellationToken))
            {
                return Result<ConversationDetailResponse>.Failure("Conversation member not found.");
            }
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
        return Result<ConversationDetailResponse>.Success(await ToDetailAsync(conversation, cancellationToken, userId));
    }

    public async Task<Result<ConversationDetailResponse>> GetAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ConversationDetailResponse>.Failure("Conversation not found.");
        if (!await authorization.CanViewConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<ConversationDetailResponse>(userId, "ConversationAccessDenied", "Conversation", conversationId, "Conversation not found.", cancellationToken);
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        return conversation is null ? Result<ConversationDetailResponse>.Failure("Conversation not found.") : Result<ConversationDetailResponse>.Success(await ToDetailAsync(conversation, cancellationToken, userId));
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
            return await DenyAsync<MessageResponse>(userId, "communication.message_post_denied", "Conversation", conversationId, "You are not allowed to send messages.", cancellationToken, "post_permission_denied");
        }

        var attachments = request.Attachments ?? [];
        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null) return Result<MessageResponse>.Failure("Conversation not found.");

        if (request.ClientRequestId.HasValue)
        {
            var existing = await messaging.FindMessageByClientRequestIdAsync(conversationId, userId, request.ClientRequestId.Value, cancellationToken);
            if (existing is not null)
            {
                return Result<MessageResponse>.Success(ToMessage(existing));
            }
        }
        var normalizedBody = request.Body?.Trim() ?? string.Empty;
        if (!IsSupportedMvpType(conversation.Type))
        {
            return await DenyAsync<MessageResponse>(userId, "communication.message_post_denied", "Conversation", conversationId, "You are not allowed to send messages.", cancellationToken, "disabled_conversation_type");
        }

        if (conversation.IsArchived)
        {
            return await DenyAsync<MessageResponse>(userId, "communication.message_post_denied", "Conversation", conversationId, "You are not allowed to send messages.", cancellationToken, "archived_conversation");
        }

        if (conversation.IsLocked)
        {
            return await DenyAsync<MessageResponse>(userId, "communication.message_post_denied", "Conversation", conversationId, "You are not allowed to send messages.", cancellationToken, conversation.Type == ConversationType.Thread ? "locked_thread" : "locked_conversation");
        }

        if (string.IsNullOrWhiteSpace(normalizedBody) && attachments.Count == 0)
        {
            await LogCommunicationAuditAsync(userId, "communication.message_post_denied", "Conversation", conversation.Id, conversation, null, conversation.Type == ConversationType.Thread ? conversation.Id : null, "deny", "body_empty", cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result<MessageResponse>.Failure("Message body or attachment is required.");
        }

        if (normalizedBody.Length > safetyOptions.MaxMessageLength)
        {
            await LogCommunicationAuditAsync(userId, "communication.message_post_denied", "Conversation", conversation.Id, conversation, null, conversation.Type == ConversationType.Thread ? conversation.Id : null, "deny", "body_too_large", cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result<MessageResponse>.Failure("Message body is too large.");
        }

        if (attachments.Count > safetyOptions.MaxAttachmentsPerMessage)
        {
            await LogCommunicationAuditAsync(userId, "communication.message_post_denied", "Conversation", conversation.Id, conversation, null, conversation.Type == ConversationType.Thread ? conversation.Id : null, "deny", "attachment_count_too_large", cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result<MessageResponse>.Failure("Too many attachments.");
        }

        var safetyDecision = safetyGuard.CheckMessagePost(new CommunicationSafetyScope(userId, conversation.TenantId, conversation.WorkspaceId, conversation.Id), normalizedBody, clock.UtcNow);
        if (!safetyDecision.IsAllowed)
        {
            var action = safetyDecision.ReasonCode == "duplicate_post" ? "communication.spam_guard_triggered" : "communication.rate_limited";
            await LogCommunicationAuditAsync(userId, action, "Conversation", conversation.Id, conversation, null, conversation.Type == ConversationType.Thread ? conversation.Id : null, "deny", safetyDecision.ReasonCode, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result<MessageResponse>.Failure("Message cannot be posted right now.");
        }

        foreach (var attachment in attachments)
        {
            var extension = Path.GetExtension(attachment.FileName).ToLowerInvariant();
            if (attachment.FileSize <= 0 || attachment.FileSize > MaxAttachmentBytes || !AllowedExtensions.Contains(extension)) return Result<MessageResponse>.Failure("Attachment is not allowed.");
        }
        var message = new Message
        {
            WorkspaceId = conversation.WorkspaceId,
            ConversationId = conversationId,
            AuthorUserId = userId,
            Body = normalizedBody,
            ClientRequestId = request.ClientRequestId,
            Version = 1,
            CreatedAt = clock.UtcNow
        };
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
        await LogCommunicationAuditAsync(userId, "communication.message_posted", "Message", message.Id, conversation, message.Id, conversation.Type == ConversationType.Thread ? conversation.Id : null, "allow", "posted", cancellationToken);
        message.AuthorUser = await users.GetByIdAsync(userId, cancellationToken);
        var createdEvent = await EnqueueMessageCreatedAsync(conversation, message, userId, cancellationToken);
        if (!createdEvent.IsSuccess)
        {
            return Result<MessageResponse>.Failure(createdEvent.Error!);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<MessageResponse>.Success(ToMessage(message));
    }

    public async Task<Result<MessageResponse>> UpdateMessageAsync(Guid messageId, UpdateMessageRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<MessageResponse>.Failure("You are not allowed to edit this message.");
        if (!await authorization.CanEditMessage(userId, messageId, cancellationToken))
        {
            return await DenyAsync<MessageResponse>(userId, "communication.message_edit_denied", "Message", messageId, "You are not allowed to edit this message.", cancellationToken, "author_required");
        }

        if (string.IsNullOrWhiteSpace(request.Body)) return Result<MessageResponse>.Failure("Message body is required.");
        var normalizedBody = request.Body.Trim();
        if (normalizedBody.Length > safetyOptions.MaxMessageLength) return Result<MessageResponse>.Failure("Message body is too large.");
        var message = await messaging.GetMessageAsync(messageId, cancellationToken);
        var conversation = await messaging.GetConversationAsync(message!.ConversationId, cancellationToken);
        if (conversation is null) return Result<MessageResponse>.Failure("Message not found.");
        message.Body = normalizedBody;
        message.EditedAt = clock.UtcNow;
        message.Version++;
        await LogCommunicationAuditAsync(userId, "communication.message_edited", "Message", message.Id, conversation, message.Id, conversation.Type == ConversationType.Thread ? conversation.Id : null, "allow", "author", cancellationToken);
        var updatedEvent = await EnqueueMessageUpdatedAsync(conversation, message, userId, cancellationToken);
        if (!updatedEvent.IsSuccess)
        {
            return Result<MessageResponse>.Failure(updatedEvent.Error!);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<MessageResponse>.Success(ToMessage(message));
    }

    public async Task<Result> DeleteMessageAsync(Guid messageId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result.Failure("You are not allowed to delete this message.");
        if (!await authorization.CanDeleteMessage(userId, messageId, cancellationToken))
        {
            return await DenyAsync(userId, "communication.message_delete_denied", "Message", messageId, "You are not allowed to delete this message.", cancellationToken, "moderation_permission_denied");
        }

        var message = await messaging.GetMessageAsync(messageId, cancellationToken);
        var conversation = await messaging.GetConversationAsync(message!.ConversationId, cancellationToken);
        if (conversation is null) return Result.Failure("Message not found.");
        var reasonCode = message.AuthorUserId == userId ? "author_delete" : "moderation_delete";
        message.MarkDeleted(clock.UtcNow, userId, reasonCode);
        message.Body = string.Empty;
        message.Version++;
        await LogCommunicationAuditAsync(userId, "communication.message_deleted", "Message", message.Id, conversation, message.Id, conversation.Type == ConversationType.Thread ? conversation.Id : null, "allow", reasonCode, cancellationToken);
        var deletedEvent = await EnqueueMessageDeletedAsync(conversation, message, userId, cancellationToken);
        if (!deletedEvent.IsSuccess)
        {
            return Result.Failure(deletedEvent.Error!);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ReportMessageAsync(Guid messageId, MessageReportRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result.Failure("You are not allowed to report this message.");
        var message = await messaging.GetMessageAsync(messageId, cancellationToken);
        if (message is null || message.DeletedAt.HasValue || !await authorization.CanViewConversation(userId, message.ConversationId, cancellationToken))
        {
            return await DenyAsync(userId, "communication.message_report_denied", "Message", messageId, "Message not found.", cancellationToken, "report_target_not_visible");
        }

        var conversation = await messaging.GetConversationAsync(message.ConversationId, cancellationToken);
        if (conversation is null) return Result.Failure("Message not found.");
        var safetyDecision = safetyGuard.CheckReport(new CommunicationSafetyScope(userId, conversation.TenantId, conversation.WorkspaceId, conversation.Id), clock.UtcNow);
        if (!safetyDecision.IsAllowed)
        {
            await LogCommunicationAuditAsync(userId, "communication.rate_limited", "Message", message.Id, conversation, message.Id, conversation.Type == ConversationType.Thread ? conversation.Id : null, "deny", safetyDecision.ReasonCode, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result.Failure("Report cannot be created right now.");
        }

        await LogCommunicationAuditAsync(userId, "communication.message_reported", "Message", message.Id, conversation, message.Id, conversation.Type == ConversationType.Thread ? conversation.Id : null, "allow", NormalizeReasonCode(request.ReasonCode, "reported"), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ReportConversationAsync(Guid conversationId, ConversationReportRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result.Failure("You are not allowed to report this conversation.");
        if (!await authorization.CanViewConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync(userId, "communication.message_report_denied", "Conversation", conversationId, "Conversation not found.", cancellationToken, "report_target_not_visible");
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null) return Result.Failure("Conversation not found.");
        var safetyDecision = safetyGuard.CheckReport(new CommunicationSafetyScope(userId, conversation.TenantId, conversation.WorkspaceId, conversation.Id), clock.UtcNow);
        if (!safetyDecision.IsAllowed)
        {
            await LogCommunicationAuditAsync(userId, "communication.rate_limited", "Conversation", conversation.Id, conversation, null, conversation.Type == ConversationType.Thread ? conversation.Id : null, "deny", safetyDecision.ReasonCode, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result.Failure("Report cannot be created right now.");
        }

        await LogCommunicationAuditAsync(userId, "communication.message_reported", "Conversation", conversation.Id, conversation, null, conversation.Type == ConversationType.Thread ? conversation.Id : null, "allow", NormalizeReasonCode(request.ReasonCode, "reported"), cancellationToken);
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
            state = new ReadState { UserId = userId, ScopeType = ReadScopeType.Conversation, ScopeId = conversationId, ConversationId = conversationId, LastReadAt = clock.UtcNow };
            await messaging.AddReadStateAsync(state, cancellationToken);
        }
        var cursorMessage = request.LastReadMessageId.HasValue
            ? await messaging.GetMessageAsync(request.LastReadMessageId.Value, cancellationToken)
            : null;
        var proposedSequence = cursorMessage?.CreatedAt.UtcTicks ?? state.LastReadSequence;
        var advanced = proposedSequence > state.LastReadSequence;
        if (advanced)
        {
            state.LastReadMessageId = request.LastReadMessageId;
            state.LastReadItemId = request.LastReadMessageId;
            state.LastReadAt = clock.UtcNow;
            state.LastReadSequence = proposedSequence;
            state.StateVersion++;
            member!.LastReadMessageId = request.LastReadMessageId;
            member.LastReadAt = state.LastReadAt;
            member.UnreadCursorMessageId = null;
        }
        await AuditParticipantStateAsync(userId, "mark_read", conversationId, "allow", "self_state_only", cancellationToken);
        if (advanced)
        {
            var unread = await messaging.CountUnreadMessagesAsync(conversationId, userId, state.LastReadAt, cancellationToken);
            var unreadEvent = await EnqueueUnreadChangedAsync(conversationId, userId, state, unread, cancellationToken);
            if (!unreadEvent.IsSuccess)
            {
                return Result.Failure(unreadEvent.Error!);
            }
        }
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
            var state = await messaging.GetReadStateAsync(conversationId, userId, cancellationToken);
            if (state is null)
            {
                state = new ReadState { UserId = userId, ScopeType = ReadScopeType.Conversation, ScopeId = conversationId, ConversationId = conversationId, LastReadAt = now };
                await messaging.AddReadStateAsync(state, cancellationToken);
            }
            var cursorMessage = await messaging.GetMessageAsync(request.LastReadMessageId.Value, cancellationToken);
            var proposedSequence = cursorMessage?.CreatedAt.UtcTicks ?? state.LastReadSequence;
            if (proposedSequence > state.LastReadSequence)
            {
                member.LastReadMessageId = request.LastReadMessageId;
                member.LastReadAt = now;
                state.LastReadMessageId = request.LastReadMessageId;
                state.LastReadItemId = request.LastReadMessageId;
                state.LastReadAt = now;
                state.LastReadSequence = proposedSequence;
                state.StateVersion++;
                var unread = await messaging.CountUnreadMessagesAsync(conversationId, userId, state.LastReadAt, cancellationToken);
                var unreadEvent = await EnqueueUnreadChangedAsync(conversationId, userId, state, unread, cancellationToken);
                if (!unreadEvent.IsSuccess)
                {
                    return Result<ParticipantStateResponse>.Failure(unreadEvent.Error!);
                }
            }
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

    private async Task<Result<ConversationDetailResponse>> SetConversationLockAsync(Guid conversationId, bool isLocked, string? reasonCode, CancellationToken cancellationToken)
    {
        if (!TryCurrentUser(out var userId)) return Result<ConversationDetailResponse>.Failure("You are not allowed to manage this conversation.");
        if (!await authorization.CanModerateConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<ConversationDetailResponse>(userId, isLocked ? "communication.conversation_lock_denied" : "communication.conversation_unlock_denied", "Conversation", conversationId, "You are not allowed to manage this conversation.", cancellationToken, "moderation_permission_denied");
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null || !IsSupportedMvpType(conversation.Type))
        {
            return Result<ConversationDetailResponse>.Failure("Conversation not found.");
        }

        conversation.IsLocked = isLocked;
        var action = isLocked
            ? conversation.Type == ConversationType.Thread ? "communication.thread_locked" : "communication.conversation_locked"
            : conversation.Type == ConversationType.Thread ? "communication.thread_unlocked" : "communication.conversation_unlocked";
        await LogCommunicationAuditAsync(userId, action, "Conversation", conversation.Id, conversation, null, conversation.Type == ConversationType.Thread ? conversation.Id : null, "allow", NormalizeReasonCode(reasonCode, isLocked ? "locked" : "unlocked"), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ConversationDetailResponse>.Success(await ToDetailAsync(conversation, cancellationToken));
    }

    private bool TryCurrentUser(out Guid userId) { userId = currentUser.UserId ?? Guid.Empty; return currentUser.IsAuthenticated && currentUser.UserId.HasValue; }
    private static bool IsSupportedMvpType(ConversationType type) => type is ConversationType.DirectMessage or ConversationType.ProjectChannel or ConversationType.Thread;

    private async Task<bool> CanBindConversationToProjectAsync(
        Project project,
        Guid userId,
        CancellationToken cancellationToken)
    {
        // A Project-bound conversation is an operational surface.  The
        // generic Messaging create command must not substitute for explicit
        // Project activation or provision channels for a provenance-ambiguous
        // Planning/Suspended Project.
        return project.Status is ProjectStatus.Active or ProjectStatus.Review or ProjectStatus.Completed &&
               await projectAuthorization.CanViewProject(userId, project.Id, cancellationToken);
    }

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

        var safetyDecision = safetyGuard.CheckThreadCreate(new CommunicationSafetyScope(userId, parent.TenantId, parent.WorkspaceId, parent.Id), clock.UtcNow);
        if (!safetyDecision.IsAllowed)
        {
            await LogCommunicationAuditAsync(userId, "communication.rate_limited", "Conversation", parent.Id, parent, null, null, "deny", safetyDecision.ReasonCode, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result<ConversationDetailResponse>.Failure("Thread cannot be created right now.");
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

    public async Task<Result<ConversationDetailResponse>> LockAsync(Guid conversationId, ConversationLockRequest request, CancellationToken cancellationToken = default)
    {
        return await SetConversationLockAsync(conversationId, isLocked: true, request.ReasonCode, cancellationToken);
    }

    public async Task<Result<ConversationDetailResponse>> UnlockAsync(Guid conversationId, ConversationLockRequest request, CancellationToken cancellationToken = default)
    {
        return await SetConversationLockAsync(conversationId, isLocked: false, request.ReasonCode, cancellationToken);
    }

    public async Task<Result<ConversationDetailResponse>> ArchiveAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId)) return Result<ConversationDetailResponse>.Failure("You are not allowed to manage this conversation.");
        if (!await authorization.CanModerateConversation(userId, conversationId, cancellationToken))
        {
            return await DenyAsync<ConversationDetailResponse>(userId, "communication.conversation_archive_denied", "Conversation", conversationId, "You are not allowed to manage this conversation.", cancellationToken, "moderation_permission_denied");
        }

        var conversation = await messaging.GetConversationAsync(conversationId, cancellationToken);
        if (conversation is null || !IsSupportedMvpType(conversation.Type))
        {
            return Result<ConversationDetailResponse>.Failure("Conversation not found.");
        }

        conversation.IsArchived = true;
        await LogCommunicationAuditAsync(userId, "communication.conversation_archived", "Conversation", conversation.Id, conversation, messageId: null, threadId: conversation.Type == ConversationType.Thread ? conversation.Id : null, decision: "allow", reasonCode: "archived", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ConversationDetailResponse>.Success(await ToDetailAsync(conversation, cancellationToken));
    }

    private Task AuditAsync(Guid actorUserId, string action, Guid targetId, CancellationToken cancellationToken) => auditLogger.LogAsync(new AuditLogEntry(actorUserId, action, "Message", targetId), cancellationToken);

    private Task LogCommunicationAuditAsync(
        Guid actorUserId,
        string action,
        string entityType,
        Guid entityId,
        Conversation conversation,
        Guid? messageId,
        Guid? threadId,
        string decision,
        string reasonCode,
        CancellationToken cancellationToken)
    {
        return auditLogger.LogAsync(new AuditLogEntry(
            actorUserId,
            action,
            entityType,
            entityId,
            "Communication safety event.",
            WorkspaceId: conversation.WorkspaceId,
            ProjectId: conversation.ProjectId,
            Metadata: new Dictionary<string, object?>
            {
                ["actorUserId"] = actorUserId,
                ["tenantId"] = conversation.TenantId,
                ["workspaceId"] = conversation.WorkspaceId,
                ["conversationId"] = conversation.Id,
                ["threadId"] = threadId,
                ["messageId"] = messageId,
                ["targetOperation"] = action,
                ["decision"] = decision,
                ["reasonCode"] = reasonCode,
                ["conversationType"] = conversation.Type.ToString(),
                ["timestamp"] = clock.UtcNow
            }),
            cancellationToken);
    }

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

    private async Task<ConversationDetailResponse> ToDetailAsync(Conversation conversation, CancellationToken cancellationToken, Guid? viewerUserId = null)
    {
        var members = await messaging.ListMembersAsync(conversation.Id, cancellationToken);
        return new ConversationDetailResponse(
            conversation.Id,
            conversation.WorkspaceId,
            conversation.ProjectId,
            conversation.Type,
            ConversationTitleFor(conversation, members, viewerUserId),
            conversation.ParentConversationId,
            conversation.RootConversationId,
            conversation.IsArchived,
            conversation.IsLocked,
            members.Select(ToMember).ToList(),
            conversation.CreatedAt,
            conversation.UpdatedAt);
    }

    private static string? ConversationTitleFor(Conversation conversation, IReadOnlyList<ConversationMember> members, Guid? viewerUserId)
    {
        if (conversation.Type != ConversationType.DirectMessage)
        {
            return conversation.Title;
        }

        if (!string.IsNullOrWhiteSpace(conversation.Title))
        {
            return conversation.Title;
        }

        return members
            .Where(member => member.UserId != viewerUserId && IsActiveParticipant(member))
            .Select(member => member.User?.DisplayName)
            .FirstOrDefault(displayName => !string.IsNullOrWhiteSpace(displayName))
            ?? "Direct message";
    }

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
        Conversation? conversation = null;
        Guid? messageId = null;
        if (entityType == "Conversation")
        {
            conversation = await messaging.GetConversationAsync(entityId, cancellationToken);
        }
        else if (entityType == "Message")
        {
            var message = await messaging.GetMessageAsync(entityId, cancellationToken);
            if (message is not null)
            {
                messageId = message.Id;
                conversation = await messaging.GetConversationAsync(message.ConversationId, cancellationToken);
            }
        }

        return new Dictionary<string, object?>
        {
            ["actorUserId"] = actorUserId,
            ["tenantId"] = conversation?.TenantId,
            ["workspaceId"] = conversation?.WorkspaceId,
            ["conversationId"] = conversation?.Id,
            ["threadId"] = conversation?.Type == ConversationType.Thread ? conversation.Id : null,
            ["messageId"] = messageId,
            ["targetOperation"] = action,
            ["decision"] = "deny",
            ["reasonCode"] = reasonCode ?? DefaultReasonCode(action),
            ["participantState"] = conversation is not null
                ? await GetParticipantStateAsync(conversation.Id, actorUserId, cancellationToken)
                : "unknown",
            ["conversationType"] = conversation?.Type.ToString(),
            ["timestamp"] = clock.UtcNow
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
            "MessageSendDenied" or "communication.message_post_denied" => "participant_post_denied",
            "communication.message_edit_denied" => "author_required",
            "communication.message_delete_denied" => "moderation_permission_denied",
            "communication.message_report_denied" => "report_target_not_visible",
            "communication.conversation_lock_denied" => "moderation_permission_denied",
            "ConversationManageDenied" => "participant_manage_members_denied",
            "ConversationThreadCreateDenied" => "participant_thread_create_denied",
            _ => "participant_missing"
        };
    }

    private static string NormalizeReasonCode(string? reasonCode, string fallback)
    {
        if (string.IsNullOrWhiteSpace(reasonCode))
        {
            return fallback;
        }

        var trimmed = reasonCode.Trim();
        return trimmed.Length > 80 ? trimmed[..80] : trimmed;
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
    private static MessageResponse ToMessage(Message message) => new(message.Id, message.WorkspaceId, message.ConversationId, message.AuthorUserId, message.AuthorUser?.DisplayName ?? string.Empty, message.DeletedAt.HasValue ? string.Empty : message.Body, message.Attachments.Select(a => new AttachmentResponse(a.AttachmentId, a.Attachment?.FileName ?? string.Empty, a.Attachment?.ContentType ?? string.Empty, a.Attachment?.SizeBytes ?? 0)).ToList(), message.CreatedAt, message.UpdatedAt, message.EditedAt, message.DeletedAt.HasValue, message.ClientRequestId, message.Version);

    private Task<Result<Guid>> EnqueueMessageCreatedAsync(Conversation conversation, Message message, Guid actorUserId, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            message = new
            {
                id = message.Id,
                conversationId = message.ConversationId,
                sender = new { userId = message.AuthorUserId, displayName = message.AuthorUser?.DisplayName ?? string.Empty, status = "active" },
                body = message.Body,
                createdAt = message.CreatedAt,
                updatedAt = message.UpdatedAt,
                version = message.Version,
                clientRequestId = message.ClientRequestId,
                attachmentSummaries = Array.Empty<object>()
            }
        });
        return EnqueueMessagingEventAsync("Messaging.MessageCreated.v1", "Message", message.Id, message.Version, actorUserId, message.ClientRequestId?.ToString(), payload, [new RealtimeRoutingTarget(RealtimeSubscriptionType.Conversation, conversation.Id)], cancellationToken);
    }

    private Task<Result<Guid>> EnqueueMessageUpdatedAsync(Conversation conversation, Message message, Guid actorUserId, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToElement(new { conversationId = conversation.Id, messageId = message.Id, messageVersion = message.Version, updatedAt = message.EditedAt, body = message.Body, attachmentSummaries = Array.Empty<object>(), requiresRefetch = false });
        return EnqueueMessagingEventAsync("Messaging.MessageUpdated.v1", "Message", message.Id, message.Version, actorUserId, null, payload, [new RealtimeRoutingTarget(RealtimeSubscriptionType.Conversation, conversation.Id)], cancellationToken);
    }

    private Task<Result<Guid>> EnqueueMessageDeletedAsync(Conversation conversation, Message message, Guid actorUserId, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToElement(new { conversationId = conversation.Id, messageId = message.Id, messageVersion = message.Version, deletedAt = message.DeletedAt, deletionMode = "tombstone", displayText = (string?)null });
        return EnqueueMessagingEventAsync("Messaging.MessageDeleted.v1", "Message", message.Id, message.Version, actorUserId, null, payload, [new RealtimeRoutingTarget(RealtimeSubscriptionType.Conversation, conversation.Id)], cancellationToken);
    }

    private Task<Result<Guid>> EnqueueUnreadChangedAsync(Guid conversationId, Guid userId, ReadState state, int unreadCount, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToElement(new { conversationId, userId, lastReadSequence = state.LastReadSequence, unreadCount, stateVersion = state.StateVersion, updatedAt = state.LastReadAt });
        return EnqueueMessagingEventAsync("Messaging.ConversationUnreadChanged.v1", "ConversationReadState", state.Id, state.StateVersion, userId, null, payload, [new RealtimeRoutingTarget(RealtimeSubscriptionType.User, userId)], cancellationToken);
    }

    private Task<Result<Guid>> EnqueueMessagingEventAsync(string eventType, string aggregateType, Guid aggregateId, long aggregateVersion, Guid actorUserId, string? causationId, JsonElement payload, IReadOnlyCollection<RealtimeRoutingTarget> routingTargets, CancellationToken cancellationToken)
    {
        var tenantId = conversationTenantId();
        if (tenantId == Guid.Empty)
        {
            return Task.FromResult(Result<Guid>.Failure("A matching active tenant context is required."));
        }
        return outbox.EnqueueAsync(new DurableEventEnvelope(Guid.NewGuid(), eventType, RealtimeEventCatalog.PayloadSchemaVersion1, clock.UtcNow, tenantId, aggregateType, aggregateId, aggregateVersion, new RealtimeActor("User", actorUserId), null, causationId, payload), routingTargets, cancellationToken);
    }

    private Guid conversationTenantId() => currentTenant.IsAvailable && !currentTenant.IsPlatformScope ? currentTenant.TenantId : Guid.Empty;
}
