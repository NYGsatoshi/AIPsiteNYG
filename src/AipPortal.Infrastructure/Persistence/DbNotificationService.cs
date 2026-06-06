using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Infrastructure.Persistence;

public sealed class DbNotificationService(AppDbContext dbContext, IClock clock) : INotificationService
{
    public async Task NotifyAsync(Guid recipientUserId, string title, string? body, string sourceType, Guid sourceId, CancellationToken cancellationToken = default)
    {
        _ = Enum.TryParse<SourceType>(sourceType, out var parsed);
        await dbContext.Notifications.AddAsync(new Notification
        {
            RecipientUserId = recipientUserId,
            Type = NotificationType.Message,
            SourceType = parsed,
            SourceId = sourceId,
            Title = title,
            Body = body,
            CreatedAt = clock.UtcNow
        }, cancellationToken);
    }
}
