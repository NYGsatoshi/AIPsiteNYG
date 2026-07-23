using AipPortal.Application.Messaging;

namespace AipPortal.Tests.Messaging;

public sealed class CommunicationSafetyGuardTests
{
    [Fact]
    public void Rate_limited_post_returns_actual_positive_retry_after_seconds()
    {
        var guard = new InMemoryCommunicationSafetyGuard(new CommunicationSafetyOptions
        {
            MaxPostsPerMinutePerUser = 1,
            MaxPostsPerMinutePerConversation = 10
        });
        var now = new DateTimeOffset(2026, 7, 23, 12, 0, 0, TimeSpan.Zero);
        var scope = new CommunicationSafetyScope(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

        Assert.True(guard.CheckMessagePost(scope, "first", now).IsAllowed);

        var decision = guard.CheckMessagePost(scope, "second", now.AddSeconds(7));

        Assert.False(decision.IsAllowed);
        Assert.Equal("rate_limited", decision.ReasonCode);
        Assert.Equal(53, decision.RetryAfterSeconds);
    }
}
