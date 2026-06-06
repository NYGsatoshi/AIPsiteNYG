using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Common.Interfaces;

public sealed record FileOwnerContext(
    Guid WorkspaceId,
    Guid? ProjectId = null,
    Guid? ConversationId = null,
    Guid? ChannelId = null,
    Guid? AuthorUserId = null);

public interface IFileRepository
{
    Task<Attachment?> GetAttachmentAsync(Guid attachmentId, CancellationToken cancellationToken = default);

    Task AddAttachmentAsync(Attachment attachment, CancellationToken cancellationToken = default);

    Task<FileOwnerContext?> ResolveOwnerAsync(AttachmentOwnerType ownerType, Guid ownerId, CancellationToken cancellationToken = default);
}
