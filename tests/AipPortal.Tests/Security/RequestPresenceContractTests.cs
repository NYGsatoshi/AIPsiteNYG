using System.Text.Json;
using AipPortal.Application.Integrations;
using AipPortal.Application.Notifications;

namespace AipPortal.Tests.Security;

public sealed class RequestPresenceContractTests
{
    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public void MessageNotificationPreferenceRequiresExplicitBoolean()
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<UpdateMessageNotificationPreferenceRequest>("{}", WebOptions));

        var request = JsonSerializer.Deserialize<UpdateMessageNotificationPreferenceRequest>(
            "{\"messageNotificationsEnabled\":false}", WebOptions);
        Assert.False(request!.MessageNotificationsEnabled);
    }

    [Fact]
    public void IntegrationCreationRequiresExplicitProvider()
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<CreateIntegrationAccountRequest>(
                "{\"displayName\":\"Example\",\"settingsJson\":null}", WebOptions));
    }
}
