namespace AipPortal.Application.Common.Interfaces;

public interface INotificationService
{
    Task NotifyAsync(Guid recipientUserId, string title, string? body, string sourceType, Guid sourceId, CancellationToken cancellationToken = default);
}
