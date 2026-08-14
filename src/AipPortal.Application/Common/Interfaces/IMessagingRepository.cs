using AipPortal.Application.Common;
using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

public interface IMessagingRepository
{
    Task<PagedResponse<Conversation>> ListForUserAsync(Guid userId, int page, int pageSize, CancellationToken cancellationToken = default);
    /// <summary>
    /// Returns the provider-composable authoritative Conversation readability
    /// relation, or <see langword="null"/> when the provider requires the
    /// bounded asynchronous fallback.
    /// </summary>
    IQueryable<Guid>? QueryReadableConversationIds(Guid userId);
    Task<IReadOnlySet<Guid>> FilterReadableConversationIdsAsync(Guid userId, IReadOnlyCollection<Guid> conversationIds, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<User>> SearchDirectRecipientsAsync(Guid userId, string? query, int limit, CancellationToken cancellationToken = default);
    Task<Conversation?> GetConversationAsync(Guid conversationId, CancellationToken cancellationToken = default);
    Task<Conversation?> FindDirectAsync(Guid workspaceId, Guid? projectId, Guid userAId, Guid userBId, CancellationToken cancellationToken = default);
    Task<Conversation?> FindDirectForUsersAsync(Guid userAId, Guid userBId, CancellationToken cancellationToken = default);
    Task<Workspace?> FindSharedActiveWorkspaceAsync(Guid userAId, Guid userBId, CancellationToken cancellationToken = default);
    Task<ConversationMember?> GetMemberAsync(Guid conversationId, Guid userId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ConversationMember>> ListMembersAsync(Guid conversationId, CancellationToken cancellationToken = default);
    Task<PagedResponse<Message>> ListMessagesAsync(Guid conversationId, int limit, DateTimeOffset? before, CancellationToken cancellationToken = default);
    Task<int> CountUnreadMessagesAsync(Guid conversationId, Guid userId, DateTimeOffset? lastReadAt, CancellationToken cancellationToken = default);
    Task<Message?> GetMessageAsync(Guid messageId, CancellationToken cancellationToken = default);
    Task<Message?> FindMessageByClientRequestIdAsync(Guid conversationId, Guid authorUserId, Guid clientRequestId, CancellationToken cancellationToken = default);
    Task<ReadState?> GetReadStateAsync(Guid conversationId, Guid userId, CancellationToken cancellationToken = default);
    Task AddConversationAsync(Conversation conversation, CancellationToken cancellationToken = default);
    Task AddMemberAsync(ConversationMember member, CancellationToken cancellationToken = default);
    Task AddMessageAsync(Message message, CancellationToken cancellationToken = default);
    Task AddReadStateAsync(ReadState readState, CancellationToken cancellationToken = default);
    Task AddAttachmentAsync(Attachment attachment, MessageAttachment link, CancellationToken cancellationToken = default);
}
