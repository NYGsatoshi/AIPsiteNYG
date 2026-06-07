using AipPortal.Application.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Messaging;

public sealed record ConversationListItemResponse(
    Guid Id,
    ConversationType Type,
    string? Title,
    MessageResponse? LastMessage,
    int UnreadCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record ConversationDetailResponse(
    Guid Id,
    ConversationType Type,
    string? Title,
    IReadOnlyList<ConversationMemberResponse> Members,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record CreateConversationRequest(ConversationType Type, string? Title, IReadOnlyList<Guid> MemberUserIds);

public sealed record ConversationListQuery(int Page = 1, int PageSize = 20)
{
    public int SafePage => Page < 1 ? 1 : Page;

    public int SafePageSize => Math.Clamp(PageSize, 1, 100);
}

public sealed record UpdateConversationRequest(string? Title);

public sealed record ConversationMemberResponse(Guid UserId, string DisplayName, string Email, ConversationMemberRole Role, DateTimeOffset JoinedAt, DateTimeOffset? LeftAt);

public sealed record AddConversationMemberRequest(Guid UserId);

public sealed record AttachmentMetadataRequest(string FileName, string StoredFileName, string FilePath, string ContentType, long FileSize);

public sealed record AttachmentResponse(Guid Id, string FileName, string ContentType, long FileSize);

public sealed record MessageResponse(Guid Id, Guid ConversationId, Guid AuthorUserId, string AuthorDisplayName, string Body, IReadOnlyList<AttachmentResponse> Attachments, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt, DateTimeOffset? EditedAt, bool IsDeleted);

public sealed record SendMessageRequest(string? Body, IReadOnlyList<AttachmentMetadataRequest>? Attachments = null);

public sealed record UpdateMessageRequest(string Body);

public sealed record MarkConversationReadRequest(Guid? LastReadMessageId);

public sealed record MessageListQuery(int Limit = 50, DateTimeOffset? Before = null)
{
    public int SafeLimit => Math.Clamp(Limit, 1, 100);
}
