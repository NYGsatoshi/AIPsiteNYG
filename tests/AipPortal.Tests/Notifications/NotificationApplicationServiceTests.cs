using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Notifications;
using AipPortal.Domain.Enums;

namespace AipPortal.Tests.Notifications;

public sealed class NotificationApplicationServiceTests
{
    [Fact]
    public async Task UserCannotReadAnotherUsersNotification()
    {
        var fixture = NotificationFixture.Create();
        var owner = Guid.NewGuid();
        var other = Guid.NewGuid();
        fixture.Current.UserIdValue = other;
        var notificationId = fixture.Notifications.Add(owner, NotificationType.System, "Private notice", false);

        var result = await fixture.Service.MarkAsReadAsync(notificationId);

        Assert.False(result.IsSuccess);
        Assert.False(fixture.Notifications.Items.Single().IsRead);
    }

    [Fact]
    public async Task UnreadCountExcludesReadNotifications()
    {
        var fixture = NotificationFixture.Create();
        var user = Guid.NewGuid();
        fixture.Current.UserIdValue = user;
        fixture.Notifications.Add(user, NotificationType.System, "Unread", false);
        fixture.Notifications.Add(user, NotificationType.System, "Read", true);
        fixture.Notifications.Add(Guid.NewGuid(), NotificationType.System, "Someone else", false);

        var result = await fixture.Service.GetUnreadCountAsync();

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value!.UnreadCount);
    }

    private sealed class NotificationFixture
    {
        private NotificationFixture()
        {
            Service = new NotificationApplicationService(Current, Clock, Notifications, Audit, UnitOfWork);
        }

        public FakeCurrentUser Current { get; } = new();
        public FakeClock Clock { get; } = new();
        public FakeNotifications Notifications { get; } = new();
        public FakeAuditLogger Audit { get; } = new();
        public FakeUnitOfWork UnitOfWork { get; } = new();
        public NotificationApplicationService Service { get; }

        public static NotificationFixture Create() => new();
    }

    private sealed class FakeNotifications : INotificationService
    {
        public List<Item> Items { get; } = [];

        public Guid Add(Guid userId, NotificationType type, string title, bool isRead)
        {
            var item = new Item(Guid.NewGuid(), userId, type, title, isRead);
            Items.Add(item);
            return item.Id;
        }

        public Task<bool> MarkAsReadAsync(Guid userId, Guid notificationId, CancellationToken cancellationToken = default)
        {
            var item = Items.FirstOrDefault(candidate => candidate.Id == notificationId && candidate.UserId == userId);
            if (item is null)
            {
                return Task.FromResult(false);
            }

            item.IsRead = true;
            return Task.FromResult(true);
        }

        public Task<int> GetUnreadCountAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Items.Count(item => item.UserId == userId && !item.IsRead));
        }

        public Task NotifyAsync(Guid recipientUserId, string title, string? body, string sourceType, Guid sourceId, CancellationToken cancellationToken = default)
        {
            Add(recipientUserId, NotificationType.System, title, false);
            return Task.CompletedTask;
        }

        public sealed class Item(Guid id, Guid userId, NotificationType type, string title, bool isRead)
        {
            public Guid Id { get; } = id;
            public Guid UserId { get; } = userId;
            public NotificationType Type { get; } = type;
            public string Title { get; } = title;
            public bool IsRead { get; set; } = isRead;
        }
    }

    private sealed class FakeCurrentUser : ICurrentUser
    {
        public Guid? UserIdValue { get; set; }
        public Guid? UserId => UserIdValue;
        public Guid? SessionId => null;
        public string? Email => null;
        public SystemRole? SystemRole => null;
        public bool IsAuthenticated => UserIdValue.HasValue;
    }

    private sealed class FakeClock : IClock
    {
        public DateTimeOffset UtcNow { get; } = new(2026, 6, 6, 0, 0, 0, TimeSpan.Zero);
    }

    private sealed class FakeAuditLogger : IAuditLogger
    {
        public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FakeUnitOfWork : IUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(1);
    }
}
