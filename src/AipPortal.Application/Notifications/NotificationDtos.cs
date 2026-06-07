using AipPortal.Domain.Enums;

namespace AipPortal.Application.Notifications;

public sealed record NotificationListQuery(int Page = 1, int PageSize = 20);

public sealed record NotificationListItemResponse(
    Guid Id,
    Guid UserId,
    NotificationType NotificationType,
    string Title,
    string? Body,
    string? RelatedEntityType,
    Guid? RelatedEntityId,
    bool IsRead,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ReadAt,
    string? TargetRoute);

public sealed record NotificationUnreadCountResponse(int UnreadCount);
