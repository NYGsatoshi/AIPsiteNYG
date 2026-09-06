namespace AipPortal.Web.Middleware;

public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers.TryAdd("X-Content-Type-Options", "nosniff");
        headers.TryAdd("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.TryAdd("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        // TODO: Replace this temporary Angular runtime style allowance with nonce-based CSP via ngCspNonce/CSP_NONCE.
        // SignalR upgrades same-origin connections to ws/wss. Explicit schemes
        // keep the rollout CSP-compatible in browsers that do not infer them
        // from 'self'.
        var requestHost = context.Request.Host.ToUriComponent();
        var websocketSources = string.IsNullOrWhiteSpace(requestHost)
            ? string.Empty
            : $" ws://{requestHost} wss://{requestHost}";
        headers.TryAdd(
            "Content-Security-Policy",
            $"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:{websocketSources}; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'");

        if (IsTaskDetailRead(context.Request))
        {
            headers.CacheControl = "no-store, max-age=0";
            headers.Pragma = "no-cache";
            headers.Expires = "0";
        }

        await next(context);
    }

    private static bool IsTaskDetailRead(HttpRequest request)
    {
        if (!HttpMethods.IsGet(request.Method) ||
            !request.Path.StartsWithSegments("/api/tasks", out var remaining))
        {
            return false;
        }

        var taskIdSegment = remaining.Value?.Trim('/');
        return Guid.TryParse(taskIdSegment, out _);
    }
}
