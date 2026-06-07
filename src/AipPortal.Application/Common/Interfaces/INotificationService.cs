using AipPortal.Application.Common;
using AipPortal.Application.Notifications;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Common.Interfaces;

public interface INotificationService
{
    Task<Guid> CreateAsync(
        Guid userId,
        NotificationType type,
        string title,
        string? body,
        string? relatedEntityType,
        Guid? relatedEntityId,
        CancellationToken cancellationToken = default)
    {
        return Task.FromResult(Guid.Empty);
    }

    Task<IReadOnlyList<Guid>> CreateManyAsync(
        IReadOnlyCollection<Guid> userIds,
        NotificationType type,
        string title,
        string? body,
        string? relatedEntityType,
        Guid? relatedEntityId,
        Guid? actorUserId = null,
        CancellationToken cancellationToken = default)
    {
        return Task.FromResult<IReadOnlyList<Guid>>([]);
    }

    Task<bool> MarkAsReadAsync(Guid userId, Guid notificationId, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(false);
    }

    Task<int> MarkAllAsReadAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(0);
    }

    Task<int> GetUnreadCountAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(0);
    }

    Task<PagedResponse<NotificationListItemResponse>> ListAsync(Guid userId, int page, int pageSize, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new PagedResponse<NotificationListItemResponse>([], page, pageSize, 0));
    }

    Task<bool> DeleteAsync(Guid userId, Guid notificationId, DateTimeOffset deletedAt, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(false);
    }

    Task NotifyAsync(Guid recipientUserId, string title, string? body, string sourceType, Guid sourceId, CancellationToken cancellationToken = default);
}
