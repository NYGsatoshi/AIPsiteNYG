using System.Text.Json;
using AipPortal.Application.Integrations;
using AipPortal.Application.Notifications;

namespace AipPortal.Tests.Security;

public sealed class RequestPresenceContractTests
{
    [Fact]
    public void MessageNotificationPreferenceRequiresExplicitBoolean()
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<UpdateMessageNotificationPreferenceRequest>("{}"));

        var request = JsonSerializer.Deserialize<UpdateMessageNotificationPreferenceRequest>(
            "{\"messageNotificationsEnabled\":false}");
        Assert.False(request!.MessageNotificationsEnabled);
    }

    [Fact]
    public void IntegrationCreationRequiresExplicitProvider()
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<CreateIntegrationAccountRequest>(
                "{\"displayName\":\"Example\",\"settingsJson\":null}"));
    }
}
