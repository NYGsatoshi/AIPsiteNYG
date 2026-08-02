using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Notifications;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Npgsql;

namespace AipPortal.Infrastructure.Persistence;

public sealed class DbNotificationService(
    AppDbContext dbContext,
    IClock clock,
    ICurrentTenant currentTenant,
    ITransactionalOutbox? outbox = null) : INotificationService
{
    private const string NotificationUserStateIdentityIndex = "IX_notification_user_states_TenantId_UserId";

    public async Task<Guid> CreateOrGetByLogicalKeyAsync(
        Guid userId,
        NotificationType type,
        string title,
        string? body,
        string? relatedEntityType,
        Guid? relatedEntityId,
        string logicalKey,
        CancellationToken cancellationToken = default)
    {
        if (!currentTenant.IsAvailable)
        {
            throw new InvalidOperationException("A tenant scope is required to create a logical notification.");
        }

        var normalizedLogicalKey = NormalizeLogicalKey(logicalKey);
        var local = dbContext.Notifications.Local.FirstOrDefault(notification =>
            notification.TenantId == currentTenant.TenantId &&
            notification.UserId == userId &&
            string.Equals(notification.LogicalKey, normalizedLogicalKey, StringComparison.Ordinal));
        if (local is not null)
        {
            return local.Id;
        }

        var existing = await FindLogicalNotificationAsync(userId, normalizedLogicalKey, cancellationToken);
        if (existing.HasValue)
        {
            // This intentionally includes soft-deleted rows. A recipient's
            // deletion must not let an Outbox replay resurrect the same event.
            return existing.Value;
        }

        // The first ever notification for a recipient may also race on the
        // NotificationUserState identity. Retry that narrow setup race once;
        // a logical-key unique violation itself must always re-read a row.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var originalEntries = CaptureTrackedEntries();
            var now = clock.UtcNow;
            var state = await GetOrCreateUserStateAsync(userId, now, cancellationToken);
            var stateVersion = AdvanceState(state, now);
            var notification = new Notification
            {
                TenantId = currentTenant.TenantId,
                UserId = userId,
                LogicalKey = normalizedLogicalKey,
                NotificationType = type,
                Title = title.Trim(),
                Body = string.IsNullOrWhiteSpace(body) ? null : body.Trim(),
                RelatedEntityType = string.IsNullOrWhiteSpace(relatedEntityType) ? null : relatedEntityType.Trim(),
                RelatedEntityId = relatedEntityId,
                CreatedAt = now,
                StateVersion = stateVersion
            };

            await dbContext.Notifications.AddAsync(notification, cancellationToken);
            await EnqueueCreatedAsync(notification, stateVersion, cancellationToken);

            try
            {
                // This makes the unique index authoritative for this explicit
                // create-or-get primitive. A future business mutation must run
                // it inside the caller-owned transaction to retain atomicity.
                await dbContext.SaveChangesAsync(cancellationToken);
                return notification.Id;
            }
            catch (DbUpdateException exception) when (TryGetRetriableUniqueConflict(exception, out var isLogicalKeyConflict))
            {
                RestoreTrackedEntries(originalEntries);

                existing = await FindLogicalNotificationAsync(userId, normalizedLogicalKey, cancellationToken);
                if (existing.HasValue)
                {
                    return existing.Value;
                }

                if (!isLogicalKeyConflict && attempt == 0)
                {
                    continue;
                }

                // A matching logical-key violation without a safely readable
                // row is not success. Preserve the original database failure.
                throw;
            }
        }

        throw new InvalidOperationException("The notification logical identity could not be persisted.");
    }

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

        var now = clock.UtcNow;
        var state = await GetOrCreateUserStateAsync(userId, now, cancellationToken);
        var stateVersion = AdvanceState(state, now);
        var notification = new Notification
        {
            UserId = userId,
            NotificationType = type,
            Title = normalizedTitle,
            Body = string.IsNullOrWhiteSpace(body) ? null : body.Trim(),
            RelatedEntityType = string.IsNullOrWhiteSpace(relatedEntityType) ? null : relatedEntityType.Trim(),
            RelatedEntityId = relatedEntityId,
            CreatedAt = now,
            StateVersion = stateVersion
        };

        await dbContext.Notifications.AddAsync(notification, cancellationToken);
        await EnqueueCreatedAsync(notification, stateVersion, cancellationToken);
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
            var now = clock.UtcNow;
            var stateVersion = AdvanceState(await GetOrCreateUserStateAsync(userId, now, cancellationToken), now);
            notification.IsRead = true;
            notification.ReadAt = now;
            notification.StateVersion = stateVersion;
            await EnqueueReadStateChangeAsync(userId, notification.Id, "read", stateVersion, now, cancellationToken);
        }

        return true;
    }

    public async Task<int> MarkAllAsReadAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var unread = await dbContext.Notifications
            .Where(notification => notification.UserId == userId && !notification.IsRead && notification.DeletedAt == null)
            .ToListAsync(cancellationToken);

        if (unread.Count == 0)
        {
            return 0;
        }

        var now = clock.UtcNow;
        var stateVersion = AdvanceState(await GetOrCreateUserStateAsync(userId, now, cancellationToken), now);
        foreach (var notification in unread)
        {
            notification.IsRead = true;
            notification.ReadAt = now;
            notification.StateVersion = stateVersion;
        }

        await EnqueueReadStateChangeAsync(userId, null, "allRead", stateVersion, now, cancellationToken);

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
                BuildTargetRoute(notification.RelatedEntityType, notification.RelatedEntityId),
                notification.StateVersion))
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

        var stateVersion = AdvanceState(await GetOrCreateUserStateAsync(userId, deletedAt, cancellationToken), deletedAt);
        notification.DeletedAt = deletedAt;
        notification.StateVersion = stateVersion;
        await EnqueueReadStateChangeAsync(userId, notification.Id, "deleted", stateVersion, deletedAt, cancellationToken);
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

        if (string.Equals(sourceType, "ActivityEvent", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(sourceType, "Event", StringComparison.OrdinalIgnoreCase))
        {
            return NotificationType.Event;
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
            "ActivityEvent" or "Event" => $"/events/{relatedEntityId}",
            "InternalForm" or "Form" => $"/forms/{relatedEntityId}",
            "Project" => $"/projects/{relatedEntityId}",
            "TaskItem" or "Task" => $"/tasks/{relatedEntityId}",
            "Artifact" => $"/artifacts/{relatedEntityId}",
            "Message" => $"/messages/{relatedEntityId}",
            "Post" => $"/posts/{relatedEntityId}",
            _ => null
        };
    }

    private async Task<Guid?> FindLogicalNotificationAsync(
        Guid userId,
        string logicalKey,
        CancellationToken cancellationToken)
    {
        return await dbContext.Notifications
            .AsNoTracking()
            .Where(notification =>
                notification.TenantId == currentTenant.TenantId &&
                notification.UserId == userId &&
                notification.LogicalKey == logicalKey)
            .Select(notification => (Guid?)notification.Id)
            .SingleOrDefaultAsync(cancellationToken);
    }

    private static string NormalizeLogicalKey(string logicalKey)
    {
        if (string.IsNullOrWhiteSpace(logicalKey))
        {
            throw new ArgumentException("A logical notification key is required.", nameof(logicalKey));
        }

        var normalized = logicalKey.Trim();
        if (normalized.Length > NotificationLogicalKeyContract.MaximumLength)
        {
            throw new ArgumentException(
                $"A logical notification key may not exceed {NotificationLogicalKeyContract.MaximumLength} characters.",
                nameof(logicalKey));
        }

        return normalized;
    }

    private static bool TryGetRetriableUniqueConflict(DbUpdateException exception, out bool isLogicalKeyConflict)
    {
        isLogicalKeyConflict = false;
        if (exception.InnerException is not PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation
            } postgres)
        {
            return false;
        }

        isLogicalKeyConflict = string.Equals(
            postgres.ConstraintName,
            NotificationLogicalKeyContract.UniqueIndexName,
            StringComparison.Ordinal);
        return isLogicalKeyConflict || string.Equals(
            postgres.ConstraintName,
            NotificationUserStateIdentityIndex,
            StringComparison.Ordinal);
    }

    private Dictionary<object, TrackedEntrySnapshot> CaptureTrackedEntries()
    {
        return dbContext.ChangeTracker.Entries()
            .ToDictionary(
                entry => entry.Entity,
                entry => new TrackedEntrySnapshot(
                    entry.State,
                    entry.CurrentValues.Clone(),
                    entry.OriginalValues.Clone()));
    }

    private void RestoreTrackedEntries(IReadOnlyDictionary<object, TrackedEntrySnapshot> originalEntries)
    {
        foreach (var entry in dbContext.ChangeTracker.Entries().ToList())
        {
            if (!originalEntries.TryGetValue(entry.Entity, out var snapshot))
            {
                entry.State = EntityState.Detached;
                continue;
            }

            entry.CurrentValues.SetValues(snapshot.CurrentValues);
            entry.OriginalValues.SetValues(snapshot.OriginalValues);
            entry.State = snapshot.State;
        }
    }

    private sealed record TrackedEntrySnapshot(
        EntityState State,
        PropertyValues CurrentValues,
        PropertyValues OriginalValues);

    private async Task<NotificationUserState> GetOrCreateUserStateAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var state = await dbContext.NotificationUserStates.SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);
        if (state is not null)
        {
            return state;
        }

        state = new NotificationUserState
        {
            TenantId = currentTenant.TenantId,
            UserId = userId,
            Version = 0,
            UpdatedAt = now
        };
        await dbContext.NotificationUserStates.AddAsync(state, cancellationToken);
        return state;
    }

    private static long AdvanceState(NotificationUserState state, DateTimeOffset now)
    {
        state.Version = checked(state.Version + 1);
        state.UpdatedAt = now;
        return state.Version;
    }

    private async Task EnqueueCreatedAsync(Notification notification, long stateVersion, CancellationToken cancellationToken)
    {
        if (outbox is null || !currentTenant.IsAvailable)
        {
            return;
        }

        var unreadCount = await GetUnreadCountAsync(notification.UserId, cancellationToken) + 1;
        var payload = System.Text.Json.JsonSerializer.SerializeToElement(new
        {
            notification = new
            {
                id = notification.Id,
                type = notification.NotificationType.ToString(),
                title = notification.Title,
                body = notification.Body,
                createdAt = notification.CreatedAt,
                isRead = false,
                target = new
                {
                    targetType = notification.RelatedEntityType,
                    targetId = notification.RelatedEntityId,
                    route = BuildTargetRoute(notification.RelatedEntityType, notification.RelatedEntityId)
                },
                version = notification.StateVersion
            },
            unreadCount,
            stateVersion
        });
        await EnqueueAsync("Notifications.NotificationCreated.v1", notification.Id, notification.StateVersion, notification.CreatedAt, payload, notification.UserId, cancellationToken);
    }

    private async Task EnqueueReadStateChangeAsync(Guid userId, Guid? notificationId, string change, long stateVersion, DateTimeOffset updatedAt, CancellationToken cancellationToken)
    {
        if (outbox is null || !currentTenant.IsAvailable)
        {
            return;
        }

        var unreadCount = await GetUnreadCountAsync(userId, cancellationToken);
        var payload = System.Text.Json.JsonSerializer.SerializeToElement(new { notificationId, change, unreadCount, stateVersion, updatedAt });
        await EnqueueAsync("Notifications.NotificationReadStateChanged.v1", notificationId ?? userId, stateVersion, updatedAt, payload, userId, cancellationToken);
    }

    private async Task EnqueueAsync(string eventType, Guid aggregateId, long aggregateVersion, DateTimeOffset occurredAt, System.Text.Json.JsonElement payload, Guid recipientUserId, CancellationToken cancellationToken)
    {
        var result = await outbox!.EnqueueAsync(
            new DurableEventEnvelope(Guid.NewGuid(), eventType, RealtimeEventCatalog.PayloadSchemaVersion1, occurredAt, currentTenant.TenantId,
                "Notification", aggregateId, aggregateVersion, RealtimeActor.System(), null, null, payload),
            [new RealtimeRoutingTarget(RealtimeSubscriptionType.User, recipientUserId)],
            cancellationToken);
        if (!result.IsSuccess)
        {
            throw new InvalidOperationException("Notification realtime event could not be persisted.");
        }
    }
}
