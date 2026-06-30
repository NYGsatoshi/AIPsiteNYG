namespace AipPortal.Application.Messaging;

public interface ICommunicationSafetyGuard
{
    CommunicationSafetyDecision CheckMessagePost(CommunicationSafetyScope scope, string normalizedBody, DateTimeOffset now);
    CommunicationSafetyDecision CheckThreadCreate(CommunicationSafetyScope scope, DateTimeOffset now);
    CommunicationSafetyDecision CheckReport(CommunicationSafetyScope scope, DateTimeOffset now);
}

public sealed record CommunicationSafetyScope(
    Guid ActorUserId,
    Guid TenantId,
    Guid WorkspaceId,
    Guid ConversationId);

public sealed record CommunicationSafetyDecision(bool IsAllowed, string ReasonCode)
{
    public static CommunicationSafetyDecision Allow() => new(true, "allow");
    public static CommunicationSafetyDecision Deny(string reasonCode) => new(false, reasonCode);
}

