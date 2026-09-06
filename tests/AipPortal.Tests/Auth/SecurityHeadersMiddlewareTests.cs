using System.Security.Claims;
using AipPortal.Web.Middleware;
using Microsoft.AspNetCore.Http;

namespace AipPortal.Tests.Auth;

public sealed class SecurityHeadersMiddlewareTests
{
    [Fact]
    [Trait("Scope", "SEC-13")]
    public async Task ContentSecurityPolicyAllowsOnlyTheCurrentHostForWebSockets()
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString("portal.example.test", 8443);

        await InvokeAndStartAsync(context);

        var policy = context.Response.Headers["Content-Security-Policy"].ToString();
        Assert.NotEmpty(policy);
        Assert.Contains("connect-src 'self' ws://portal.example.test:8443 wss://portal.example.test:8443;", policy);
        Assert.DoesNotContain("connect-src 'self' https:", policy);
        Assert.DoesNotContain("connect-src 'self' ws: wss:", policy);
        Assert.DoesNotContain("'unsafe-eval'", policy);
        Assert.DoesNotContain("script-src 'self' 'unsafe-inline'", policy);
        Assert.DoesNotContain('*', policy);
    }

    [Fact]
    [Trait("Scope", "SEC-13")]
    public async Task ResponseContainsCanonicalBrowserSecurityHeaders()
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString("portal.example.test");

        await InvokeAndStartAsync(context);

        Assert.Equal("nosniff", context.Response.Headers["X-Content-Type-Options"]);
        Assert.Equal("DENY", context.Response.Headers["X-Frame-Options"]);
        Assert.Equal("strict-origin-when-cross-origin", context.Response.Headers["Referrer-Policy"]);
        Assert.Equal("camera=(), microphone=(), geolocation=()", context.Response.Headers["Permissions-Policy"]);
        Assert.Contains("frame-ancestors 'none'", context.Response.Headers["Content-Security-Policy"].ToString());
    }

    [Fact]
    [Trait("Scope", "SEC-13")]
    public async Task AuthenticatedResponseIsExplicitlyNoStore()
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString("portal.example.test");
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())],
            "test"));

        await InvokeAndStartAsync(context);

        Assert.Equal("no-store, no-cache, max-age=0", context.Response.Headers["Cache-Control"]);
        Assert.Equal("no-cache", context.Response.Headers["Pragma"]);
        Assert.Equal("0", context.Response.Headers["Expires"]);
    }

    [Fact]
    [Trait("Scope", "SEC-13")]
    public async Task CookieSettingResponseIsExplicitlyNoStore()
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString("portal.example.test");

        await InvokeAndStartAsync(context, response =>
        {
            response.Headers["Set-Cookie"] = ".AipPortal.Auth=value; path=/; secure; httponly";
        });

        Assert.Equal("no-store, no-cache, max-age=0", context.Response.Headers["Cache-Control"]);
    }

    [Fact]
    [Trait("Scope", "SEC-13")]
    public async Task ExternalRedirectIsRejectedBeforeHeadersAreSent()
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString("portal.example.test");

        await InvokeAndStartAsync(context, response =>
        {
            response.StatusCode = StatusCodes.Status302Found;
            response.Headers["Location"] = "https://attacker.example/collect";
        });

        Assert.Equal(StatusCodes.Status400BadRequest, context.Response.StatusCode);
        Assert.False(context.Response.Headers.ContainsKey("Location"));
        Assert.Equal("no-store, no-cache, max-age=0", context.Response.Headers["Cache-Control"]);
    }

    [Fact]
    [Trait("Scope", "SEC-13")]
    public async Task SameHostHttpsUpgradeRedirectRemainsAllowed()
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("portal.example.test", 80);

        await InvokeAndStartAsync(context, response =>
        {
            response.StatusCode = StatusCodes.Status307TemporaryRedirect;
            response.Headers["Location"] = "https://portal.example.test/app/";
        });

        Assert.Equal(StatusCodes.Status307TemporaryRedirect, context.Response.StatusCode);
        Assert.Equal("https://portal.example.test/app/", context.Response.Headers["Location"]);
    }

    private static async Task InvokeAndStartAsync(
        DefaultHttpContext context,
        Action<HttpResponse>? configureResponse = null)
    {
        context.Response.Body = new MemoryStream();
        var middleware = new SecurityHeadersMiddleware(_ =>
        {
            configureResponse?.Invoke(context.Response);
            return Task.CompletedTask;
        });

        await middleware.InvokeAsync(context);
        await context.Response.StartAsync();
    }
}
