using AipPortal.Application.Channels;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Files;

public sealed class FileAuthorizationService(
    IFileRepository files,
    IProjectAuthorizationService projects,
    IConversationAuthorizationService conversations,
    IChannelAuthorizationService channels) : IFileAuthorizationService
{
    public async Task<bool> CanUploadAttachment(Guid userId, AttachmentOwnerType ownerType, Guid ownerId, CancellationToken cancellationToken = default)
    {
        var owner = await files.ResolveOwnerAsync(ownerType, ownerId, cancellationToken);
        if (owner is null)
        {
            return false;
        }

        if (owner.ProjectId.HasValue)
        {
            return await projects.CanViewProject(userId, owner.ProjectId.Value, cancellationToken);
        }

        if (owner.ConversationId.HasValue)
        {
            return await conversations.CanSendMessage(userId, owner.ConversationId.Value, cancellationToken);
        }

        return owner.ChannelId.HasValue && await channels.CanPostToChannel(userId, owner.ChannelId.Value, cancellationToken);
    }

    public async Task<bool> CanViewAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default)
    {
        if (attachment.DeletedAt.HasValue || !attachment.OwnerType.HasValue || !attachment.OwnerId.HasValue)
        {
            return false;
        }

        var owner = await files.ResolveOwnerAsync(attachment.OwnerType.Value, attachment.OwnerId.Value, cancellationToken);
        if (owner is null)
        {
            return false;
        }

        if (owner.ProjectId.HasValue)
        {
            return await projects.CanViewProject(userId, owner.ProjectId.Value, cancellationToken);
        }

        if (owner.ConversationId.HasValue)
        {
            return await conversations.CanViewConversation(userId, owner.ConversationId.Value, cancellationToken);
        }

        return owner.ChannelId.HasValue && await channels.CanViewChannel(userId, owner.ChannelId.Value, cancellationToken);
    }

    public Task<bool> CanDownloadAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default)
    {
        return CanViewAttachment(userId, attachment, cancellationToken);
    }

    public async Task<bool> CanDeleteAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default)
    {
        if (attachment.DeletedAt.HasValue)
        {
            return false;
        }

        if (attachment.UploadedByUserId == userId || attachment.OwnerUserId == userId)
        {
            return true;
        }

        if (!attachment.OwnerType.HasValue || !attachment.OwnerId.HasValue)
        {
            return false;
        }

        var owner = await files.ResolveOwnerAsync(attachment.OwnerType.Value, attachment.OwnerId.Value, cancellationToken);
        return owner?.ProjectId.HasValue == true &&
            await projects.CanManageProject(userId, owner.ProjectId.Value, cancellationToken);
    }
}
