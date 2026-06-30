using System.Security.Cryptography;
using System.Text;

namespace AipPortal.Application.Messaging;

public sealed class InMemoryCommunicationSafetyGuard(CommunicationSafetyOptions options) : ICommunicationSafetyGuard
{
    private readonly object gate = new();
    private readonly Dictionary<string, Queue<DateTimeOffset>> windows = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTimeOffset> duplicatePosts = new(StringComparer.Ordinal);

    public CommunicationSafetyDecision CheckMessagePost(CommunicationSafetyScope scope, string normalizedBody, DateTimeOffset now)
    {
        lock (gate)
        {
            if (IsLimited($"post:user:{scope.TenantId:N}:{scope.WorkspaceId:N}:{scope.ActorUserId:N}", options.MaxPostsPerMinutePerUser, TimeSpan.FromMinutes(1), now) ||
                IsLimited($"post:conversation:{scope.TenantId:N}:{scope.WorkspaceId:N}:{scope.ConversationId:N}", options.MaxPostsPerMinutePerConversation, TimeSpan.FromMinutes(1), now))
            {
                return CommunicationSafetyDecision.Deny("rate_limited");
            }

            if (!string.IsNullOrEmpty(normalizedBody))
            {
                var duplicateKey = $"duplicate:{scope.TenantId:N}:{scope.WorkspaceId:N}:{scope.ConversationId:N}:{scope.ActorUserId:N}:{Hash(normalizedBody)}";
                var duplicateWindow = TimeSpan.FromSeconds(Math.Max(1, options.DuplicatePostWindowSeconds));
                if (duplicatePosts.TryGetValue(duplicateKey, out var lastPostedAt) && now - lastPostedAt < duplicateWindow)
                {
                    duplicatePosts[duplicateKey] = now;
                    return CommunicationSafetyDecision.Deny("duplicate_post");
                }

                duplicatePosts[duplicateKey] = now;
            }

            return CommunicationSafetyDecision.Allow();
        }
    }

    public CommunicationSafetyDecision CheckThreadCreate(CommunicationSafetyScope scope, DateTimeOffset now)
    {
        lock (gate)
        {
            return IsLimited($"thread:user:{scope.TenantId:N}:{scope.WorkspaceId:N}:{scope.ActorUserId:N}", options.MaxThreadCreatesPerMinutePerUser, TimeSpan.FromMinutes(1), now)
                ? CommunicationSafetyDecision.Deny("rate_limited")
                : CommunicationSafetyDecision.Allow();
        }
    }

    public CommunicationSafetyDecision CheckReport(CommunicationSafetyScope scope, DateTimeOffset now)
    {
        lock (gate)
        {
            return IsLimited($"report:user:{scope.TenantId:N}:{scope.WorkspaceId:N}:{scope.ActorUserId:N}", options.MaxReportsPerHourPerUser, TimeSpan.FromHours(1), now)
                ? CommunicationSafetyDecision.Deny("rate_limited")
                : CommunicationSafetyDecision.Allow();
        }
    }

    private bool IsLimited(string key, int limit, TimeSpan window, DateTimeOffset now)
    {
        var boundedLimit = Math.Max(1, limit);
        if (!windows.TryGetValue(key, out var queue))
        {
            queue = new Queue<DateTimeOffset>();
            windows[key] = queue;
        }

        while (queue.Count > 0 && now - queue.Peek() >= window)
        {
            queue.Dequeue();
        }

        if (queue.Count >= boundedLimit)
        {
            return true;
        }

        queue.Enqueue(now);
        return false;
    }

    private static string Hash(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes);
    }
}

