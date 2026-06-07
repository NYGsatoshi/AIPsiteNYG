using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;

namespace AipPortal.Application.Notifications;

public sealed class NotificationApplicationService(
    ICurrentUser currentUser,
    IClock clock,
    INotificationService notifications,
    IAuditLogger auditLogger,
    IUnitOfWork unitOfWork) : INotificationApplicationService
{
    private const int MaxPageSize = 100;

    public async Task<Result<PagedResponse<NotificationListItemResponse>>> ListAsync(NotificationListQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<PagedResponse<NotificationListItemResponse>>.Failure("Authentication is required.");
        }

        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);
        return Result<PagedResponse<NotificationListItemResponse>>.Success(await notifications.ListAsync(userId, page, pageSize, cancellationToken));
    }

    public async Task<Result<NotificationUnreadCountResponse>> GetUnreadCountAsync(CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<NotificationUnreadCountResponse>.Failure("Authentication is required.");
        }

        return Result<NotificationUnreadCountResponse>.Success(new NotificationUnreadCountResponse(await notifications.GetUnreadCountAsync(userId, cancellationToken)));
    }

    public async Task<Result> MarkAsReadAsync(Guid notificationId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result.Failure("Authentication is required.");
        }

        if (!await notifications.MarkAsReadAsync(userId, notificationId, cancellationToken))
        {
            return Result.Failure("Notification not found.");
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> MarkAllAsReadAsync(CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result.Failure("Authentication is required.");
        }

        await notifications.MarkAllAsReadAsync(userId, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> DeleteAsync(Guid notificationId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result.Failure("Authentication is required.");
        }

        if (!await notifications.DeleteAsync(userId, notificationId, clock.UtcNow, cancellationToken))
        {
            return Result.Failure("Notification not found.");
        }

        await auditLogger.LogUserActionAsync(userId, "NotificationDeleted", "Notification", notificationId, "Notification deleted.", cancellationToken: cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }
}
