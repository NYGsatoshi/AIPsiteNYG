using AipPortal.Application.Common;

namespace AipPortal.Application.Notifications;

public interface INotificationApplicationService
{
    Task<Result<PagedResponse<NotificationListItemResponse>>> ListAsync(NotificationListQuery query, CancellationToken cancellationToken = default);

    Task<Result<NotificationUnreadCountResponse>> GetUnreadCountAsync(CancellationToken cancellationToken = default);

    Task<Result> MarkAsReadAsync(Guid notificationId, CancellationToken cancellationToken = default);

    Task<Result> MarkAllAsReadAsync(CancellationToken cancellationToken = default);

    Task<Result> DeleteAsync(Guid notificationId, CancellationToken cancellationToken = default);
}
