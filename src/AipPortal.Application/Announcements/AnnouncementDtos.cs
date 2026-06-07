using AipPortal.Domain.Enums;

namespace AipPortal.Application.Announcements;

public sealed record AnnouncementListQuery(int Page = 1, int PageSize = 20, Guid? WorkspaceId = null, Guid? GroupId = null, Guid? ChannelId = null);

public sealed record AnnouncementListItemResponse(
    Guid Id,
    Guid? WorkspaceId,
    Guid? GroupId,
    Guid? ChannelId,
    Guid AuthorUserId,
    string Title,
    AnnouncementPriority Priority,
    bool IsPinned,
    bool RequiresReadConfirmation,
    bool IsRead,
    DateTimeOffset PublishedAt,
    DateTimeOffset? ExpiresAt);

public sealed record AnnouncementDetailResponse(
    Guid Id,
    Guid? WorkspaceId,
    Guid? GroupId,
    Guid? ChannelId,
    Guid AuthorUserId,
    string Title,
    string Body,
    AnnouncementPriority Priority,
    bool IsPinned,
    bool RequiresReadConfirmation,
    bool IsRead,
    DateTimeOffset PublishedAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record CreateAnnouncementRequest(
    Guid? WorkspaceId,
    Guid? GroupId,
    Guid? ChannelId,
    string Title,
    string Body,
    AnnouncementPriority Priority = AnnouncementPriority.Normal,
    bool IsPinned = false,
    bool RequiresReadConfirmation = false,
    DateTimeOffset? PublishedAt = null,
    DateTimeOffset? ExpiresAt = null);

public sealed record UpdateAnnouncementRequest(
    string? Title = null,
    string? Body = null,
    AnnouncementPriority? Priority = null,
    bool? IsPinned = null,
    bool? RequiresReadConfirmation = null,
    DateTimeOffset? PublishedAt = null,
    DateTimeOffset? ExpiresAt = null);

public sealed record AnnouncementUnreadUserResponse(Guid UserId, string DisplayName, string Email);

public sealed record AnnouncementReadStatusResponse(
    Guid AnnouncementId,
    int TargetUserCount,
    int ReadCount,
    int UnreadCount,
    IReadOnlyList<AnnouncementUnreadUserResponse> UnreadUsers);
