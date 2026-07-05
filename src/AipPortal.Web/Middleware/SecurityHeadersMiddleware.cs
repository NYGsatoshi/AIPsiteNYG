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
        headers.TryAdd("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'");

        await next(context);
    }
}
