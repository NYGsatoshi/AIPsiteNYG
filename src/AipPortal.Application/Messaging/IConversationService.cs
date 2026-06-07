using AipPortal.Application.Common;

namespace AipPortal.Application.Messaging;

public interface IConversationService
{
    Task<Result<PagedResponse<ConversationListItemResponse>>> ListAsync(ConversationListQuery query, CancellationToken cancellationToken = default);
    Task<Result<ConversationDetailResponse>> CreateAsync(CreateConversationRequest request, CancellationToken cancellationToken = default);
    Task<Result<ConversationDetailResponse>> GetAsync(Guid conversationId, CancellationToken cancellationToken = default);
    Task<Result<ConversationDetailResponse>> UpdateAsync(Guid conversationId, UpdateConversationRequest request, CancellationToken cancellationToken = default);
    Task<Result> LeaveAsync(Guid conversationId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<ConversationMemberResponse>>> ListMembersAsync(Guid conversationId, CancellationToken cancellationToken = default);
    Task<Result<ConversationMemberResponse>> AddMemberAsync(Guid conversationId, AddConversationMemberRequest request, CancellationToken cancellationToken = default);
    Task<Result> RemoveMemberAsync(Guid conversationId, Guid userId, CancellationToken cancellationToken = default);
    Task<Result<PagedResponse<MessageResponse>>> ListMessagesAsync(Guid conversationId, MessageListQuery query, CancellationToken cancellationToken = default);
    Task<Result<MessageResponse>> SendMessageAsync(Guid conversationId, SendMessageRequest request, CancellationToken cancellationToken = default);
    Task<Result<MessageResponse>> UpdateMessageAsync(Guid messageId, UpdateMessageRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteMessageAsync(Guid messageId, CancellationToken cancellationToken = default);
    Task<Result> MarkReadAsync(Guid conversationId, MarkConversationReadRequest request, CancellationToken cancellationToken = default);
}
