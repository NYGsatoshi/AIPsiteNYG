using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Notifications;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class DbNotificationService(AppDbContext dbContext, IClock clock) : INotificationService
{
    public async Task<Guid> CreateAsync(
        Guid userId,
        NotificationType type,
        string title,
        string? body,
        string? relatedEntityType,
        Guid? relatedEntityId,
        CancellationToken cancellationToken = default)
    {
        var normalizedTitle = title.Trim();
        var existing = await dbContext.Notifications
            .Where(notification =>
                notification.UserId == userId &&
                notification.NotificationType == type &&
                notification.RelatedEntityType == relatedEntityType &&
                notification.RelatedEntityId == relatedEntityId &&
                notification.Title == normalizedTitle &&
                notification.DeletedAt == null)
            .OrderByDescending(notification => notification.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (existing is not null)
        {
            return existing.Id;
        }

        var notification = new Notification
        {
            UserId = userId,
            NotificationType = type,
            Title = normalizedTitle,
            Body = string.IsNullOrWhiteSpace(body) ? null : body.Trim(),
            RelatedEntityType = string.IsNullOrWhiteSpace(relatedEntityType) ? null : relatedEntityType.Trim(),
            RelatedEntityId = relatedEntityId,
            CreatedAt = clock.UtcNow
        };

        await dbContext.Notifications.AddAsync(notification, cancellationToken);
        return notification.Id;
    }

    public async Task<IReadOnlyList<Guid>> CreateManyAsync(
        IReadOnlyCollection<Guid> userIds,
        NotificationType type,
        string title,
        string? body,
        string? relatedEntityType,
        Guid? relatedEntityId,
        Guid? actorUserId = null,
        CancellationToken cancellationToken = default)
    {
        var ids = new List<Guid>();
        foreach (var userId in userIds.Distinct().Where(userId => userId != actorUserId))
        {
            ids.Add(await CreateAsync(userId, type, title, body, relatedEntityType, relatedEntityId, cancellationToken));
        }

        return ids;
    }

    public async Task<bool> MarkAsReadAsync(Guid userId, Guid notificationId, CancellationToken cancellationToken = default)
    {
        var notification = await dbContext.Notifications.FirstOrDefaultAsync(item =>
            item.Id == notificationId &&
            item.UserId == userId &&
            item.DeletedAt == null,
            cancellationToken);
        if (notification is null)
        {
            return false;
        }

        if (!notification.IsRead)
        {
            notification.IsRead = true;
            notification.ReadAt = clock.UtcNow;
        }

        return true;
    }

    public async Task<int> MarkAllAsReadAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var unread = await dbContext.Notifications
            .Where(notification => notification.UserId == userId && !notification.IsRead && notification.DeletedAt == null)
            .ToListAsync(cancellationToken);

        foreach (var notification in unread)
        {
            notification.IsRead = true;
            notification.ReadAt = clock.UtcNow;
        }

        return unread.Count;
    }

    public Task<int> GetUnreadCountAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        return dbContext.Notifications.CountAsync(
            notification => notification.UserId == userId && !notification.IsRead && notification.DeletedAt == null,
            cancellationToken);
    }

    public async Task<PagedResponse<NotificationListItemResponse>> ListAsync(Guid userId, int page, int pageSize, CancellationToken cancellationToken = default)
    {
        var query = dbContext.Notifications
            .AsNoTracking()
            .Where(notification => notification.UserId == userId && notification.DeletedAt == null)
            .OrderByDescending(notification => notification.CreatedAt);

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(notification => new NotificationListItemResponse(
                notification.Id,
                notification.UserId,
                notification.NotificationType,
                notification.Title,
                notification.Body,
                notification.RelatedEntityType,
                notification.RelatedEntityId,
                notification.IsRead,
                notification.CreatedAt,
                notification.ReadAt,
                BuildTargetRoute(notification.RelatedEntityType, notification.RelatedEntityId)))
            .ToListAsync(cancellationToken);

        return new PagedResponse<NotificationListItemResponse>(items, page, pageSize, total);
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid notificationId, DateTimeOffset deletedAt, CancellationToken cancellationToken = default)
    {
        var notification = await dbContext.Notifications.FirstOrDefaultAsync(item =>
            item.Id == notificationId &&
            item.UserId == userId &&
            item.DeletedAt == null,
            cancellationToken);
        if (notification is null)
        {
            return false;
        }

        notification.DeletedAt = deletedAt;
        return true;
    }

    public Task NotifyAsync(Guid recipientUserId, string title, string? body, string sourceType, Guid sourceId, CancellationToken cancellationToken = default)
    {
        return CreateAsync(recipientUserId, GuessType(title, sourceType), title, body, sourceType, sourceId, cancellationToken);
    }

    private static NotificationType GuessType(string title, string sourceType)
    {
        if (string.Equals(sourceType, "Message", StringComparison.OrdinalIgnoreCase))
        {
            return NotificationType.DirectMessage;
        }

        if (string.Equals(sourceType, "TaskItem", StringComparison.OrdinalIgnoreCase))
        {
            return title.Contains("due", StringComparison.OrdinalIgnoreCase)
                ? NotificationType.TaskDueSoon
                : NotificationType.TaskStatusChanged;
        }

        if (string.Equals(sourceType, "Artifact", StringComparison.OrdinalIgnoreCase))
        {
            return NotificationType.ArtifactUploaded;
        }

        if (string.Equals(sourceType, "Feedback", StringComparison.OrdinalIgnoreCase))
        {
            return NotificationType.FeedbackCreated;
        }

        return NotificationType.System;
    }

    private static string? BuildTargetRoute(string? relatedEntityType, Guid? relatedEntityId)
    {
        if (!relatedEntityId.HasValue || string.IsNullOrWhiteSpace(relatedEntityType))
        {
            return null;
        }

        return relatedEntityType switch
        {
            "Announcement" => $"/announcements/{relatedEntityId}",
            "Project" => $"/projects/{relatedEntityId}",
            "TaskItem" or "Task" => $"/tasks/{relatedEntityId}",
            "Artifact" => $"/artifacts/{relatedEntityId}",
            "Message" => $"/messages/{relatedEntityId}",
            "Post" => $"/posts/{relatedEntityId}",
            _ => null
        };
    }
}
