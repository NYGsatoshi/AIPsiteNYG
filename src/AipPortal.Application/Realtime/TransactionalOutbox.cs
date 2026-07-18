using System.Diagnostics;
using System.Text.Json;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Realtime;

public sealed class TransactionalOutbox(
    IOutboxEventRepository repository,
    ICurrentTenant currentTenant,
    IClock clock) : ITransactionalOutbox
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<Result<Guid>> EnqueueAsync(
        DurableEventEnvelope envelope,
        IReadOnlyCollection<RealtimeRoutingTarget> routingTargets,
        CancellationToken cancellationToken = default)
    {
        if (!currentTenant.IsAvailable || envelope.TenantId != currentTenant.TenantId)
        {
            return Result<Guid>.Failure("A matching active tenant context is required.");
        }

        if (envelope.EventId == Guid.Empty ||
            envelope.AggregateId == Guid.Empty ||
            string.IsNullOrWhiteSpace(envelope.AggregateType) ||
            !RealtimeEventCatalog.IsSupported(envelope.EventType, envelope.PayloadSchemaVersion) ||
            routingTargets.Count == 0 ||
            routingTargets.Any(target => target.ResourceId == Guid.Empty))
        {
            return Result<Guid>.Failure("The durable realtime event contract is invalid.");
        }

        if (!IsRoutingAllowed(envelope.EventType, routingTargets))
        {
            return Result<Guid>.Failure("The durable realtime event routing contract is invalid.");
        }

        var payloadJson = JsonSerializer.Serialize(envelope, JsonOptions);
        var routingJson = JsonSerializer.Serialize(routingTargets, JsonOptions);
        if (payloadJson.Length > 65536 || routingJson.Length > 8192 || ContainsProhibitedProperty(envelope.Payload))
        {
            return Result<Guid>.Failure("The durable realtime event payload is not safe to store.");
        }

        await repository.AddAsync(new OutboxEvent(envelope.EventId)
        {
            TenantId = envelope.TenantId,
            EventType = envelope.EventType,
            PayloadSchemaVersion = envelope.PayloadSchemaVersion,
            AggregateType = envelope.AggregateType,
            AggregateId = envelope.AggregateId,
            AggregateVersion = envelope.AggregateVersion,
            OccurredAt = envelope.OccurredAt,
            PayloadJson = payloadJson,
            RoutingJson = routingJson,
            CorrelationId = envelope.CorrelationId ?? Activity.Current?.TraceId.ToString(),
            CausationId = envelope.CausationId,
            Status = OutboxEventStatus.Pending,
            AttemptCount = 0,
            NextAttemptAt = clock.UtcNow
        }, cancellationToken);

        return Result<Guid>.Success(envelope.EventId);
    }

    private static bool IsRoutingAllowed(string eventType, IReadOnlyCollection<RealtimeRoutingTarget> routingTargets)
    {
        if (eventType.StartsWith("Messaging.Message", StringComparison.Ordinal))
        {
            return routingTargets.All(target => target.SubscriptionType is RealtimeSubscriptionType.Conversation or RealtimeSubscriptionType.User);
        }

        if (eventType is "Messaging.ConversationUnreadChanged.v1" or "Notifications.NotificationCreated.v1" or "Notifications.NotificationReadStateChanged.v1" or "Security.AuthorizationStateChanged.v1")
        {
            return routingTargets.All(target => target.SubscriptionType == RealtimeSubscriptionType.User);
        }

        return routingTargets.All(target => target.SubscriptionType is RealtimeSubscriptionType.User or RealtimeSubscriptionType.Workspace or RealtimeSubscriptionType.Project);
    }

    private static bool ContainsProhibitedProperty(JsonElement element)
    {
        var prohibited = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "password", "token", "inviteToken", "accessToken", "secret", "storagePath", "storageKey", "signedUrl", "connectionString", "stackTrace", "sql"
        };

        return ContainsProhibitedProperty(element, prohibited);
    }

    private static bool ContainsProhibitedProperty(JsonElement element, ISet<string> prohibited)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (prohibited.Contains(property.Name) || ContainsProhibitedProperty(property.Value, prohibited))
                {
                    return true;
                }
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                if (ContainsProhibitedProperty(item, prohibited))
                {
                    return true;
                }
            }
        }

        return false;
    }
}
