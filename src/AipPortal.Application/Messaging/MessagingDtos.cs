using AipPortal.Application.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Messaging;

public sealed record ConversationListItemResponse(
    Guid Id,
    Guid WorkspaceId,
    Guid? ProjectId,
    ConversationType Type,
    string? Title,
    Guid? ParentConversationId,
    Guid? RootConversationId,
    MessageResponse? LastMessage,
    int UnreadCount,
    bool IsMuted,
    bool IsArchived,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record ConversationDetailResponse(
    Guid Id,
    Guid WorkspaceId,
    Guid? ProjectId,
    ConversationType Type,
    string? Title,
    Guid? ParentConversationId,
    Guid? RootConversationId,
    bool IsArchived,
    bool IsLocked,
    IReadOnlyList<ConversationMemberResponse> Members,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record CreateConversationRequest(
    ConversationType Type,
    string? Title,
    IReadOnlyList<Guid> MemberUserIds,
    Guid? WorkspaceId = null,
    Guid? ProjectId = null,
    Guid? ParentConversationId = null);

public sealed record ConversationListQuery(int Page = 1, int PageSize = 20)
{
    public int SafePage => Page < 1 ? 1 : Page;

    public int SafePageSize => Math.Clamp(PageSize, 1, 100);
}

public sealed record UpdateConversationRequest(string? Title);

public sealed record ConversationLockRequest(string? ReasonCode = null);

public sealed record ConversationReportRequest(string ReasonCode, string? Reason = null);

public sealed record ConversationMemberResponse(
    Guid UserId,
    string DisplayName,
    string Email,
    ConversationMemberRole Role,
    bool CanRead,
    bool CanPost,
    bool CanManageMembers,
    bool CanCreateThread,
    DateTimeOffset JoinedAt,
    DateTimeOffset? LeftAt,
    DateTimeOffset? RemovedAt);

public sealed record AddConversationMemberRequest(Guid UserId);

public sealed record AttachmentMetadataRequest(string FileName, string StoredFileName, string FilePath, string ContentType, long FileSize);

public sealed record AttachmentResponse(Guid Id, string FileName, string ContentType, long FileSize);

public sealed record MessageResponse(Guid Id, Guid WorkspaceId, Guid ConversationId, Guid AuthorUserId, string AuthorDisplayName, string Body, IReadOnlyList<AttachmentResponse> Attachments, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt, DateTimeOffset? EditedAt, bool IsDeleted);

public sealed record SendMessageRequest(string? Body, IReadOnlyList<AttachmentMetadataRequest>? Attachments = null);

public sealed record UpdateMessageRequest(string Body);

public sealed record MessageReportRequest(string ReasonCode, string? Reason = null);

public sealed record MarkConversationReadRequest(Guid? LastReadMessageId);

public sealed record ParticipantStateResponse(
    Guid ParticipantId,
    Guid UserId,
    Guid ConversationId,
    DateTimeOffset? LastOpenedAt,
    Guid? LastReadMessageId,
    DateTimeOffset? LastReadAt,
    Guid? UnreadCursorMessageId,
    int UnreadCount,
    bool IsMuted,
    bool IsArchived,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record UpdateParticipantStateRequest(
    DateTimeOffset? LastOpenedAt = null,
    Guid? LastReadMessageId = null,
    Guid? UnreadCursorMessageId = null,
    bool? IsMuted = null,
    bool? IsArchived = null);

public sealed record MessageListQuery(int Limit = 50, DateTimeOffset? Before = null)
{
    public int SafeLimit => Math.Clamp(Limit, 1, 100);
}
