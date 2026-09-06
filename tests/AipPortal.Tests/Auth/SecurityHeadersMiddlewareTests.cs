using AipPortal.Web.Middleware;
using Microsoft.AspNetCore.Http;

namespace AipPortal.Tests.Auth;

public sealed class SecurityHeadersMiddlewareTests
{
    [Fact]
    [Trait("Scope", "TaskV1PR03C")]
    public async Task ContentSecurityPolicyAllowsOnlyTheCurrentHostForWebSockets()
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString("portal.example.test", 8443);
        var middleware = new SecurityHeadersMiddleware(_ => Task.CompletedTask);

        await middleware.InvokeAsync(context);

        var policy = context.Response.Headers["Content-Security-Policy"].ToString();
        Assert.NotEmpty(policy);
        Assert.Contains("connect-src 'self' https: ws://portal.example.test:8443 wss://portal.example.test:8443;", policy);
        Assert.DoesNotContain("connect-src 'self' https: ws: wss:", policy);
        Assert.DoesNotContain("'unsafe-eval'", policy);
    }

    [Fact]
    [Trait("Scope", "FCI-07")]
    public async Task TaskDetailReadIsExplicitlyNonCacheable()
    {
        var context = new DefaultHttpContext();
        context.Request.Method = HttpMethods.Get;
        context.Request.Path = $"/api/tasks/{Guid.NewGuid():D}";
        var middleware = new SecurityHeadersMiddleware(_ => Task.CompletedTask);

        await middleware.InvokeAsync(context);

        Assert.Equal("no-store, max-age=0", context.Response.Headers.CacheControl.ToString());
        Assert.Equal("no-cache", context.Response.Headers.Pragma.ToString());
        Assert.Equal("0", context.Response.Headers.Expires.ToString());
    }

    [Theory]
    [InlineData("/api/tasks")]
    [InlineData("/api/tasks/not-a-guid")]
    [InlineData("/api/tasks/00000000-0000-0000-0000-000000000001/activity")]
    [Trait("Scope", "FCI-07")]
    public async Task TaskNoStorePolicyDoesNotLeakToOtherTaskRoutes(string path)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = HttpMethods.Get;
        context.Request.Path = path;
        var middleware = new SecurityHeadersMiddleware(_ => Task.CompletedTask);

        await middleware.InvokeAsync(context);

        Assert.False(context.Response.Headers.ContainsKey("Cache-Control"));
        Assert.False(context.Response.Headers.ContainsKey("Pragma"));
        Assert.False(context.Response.Headers.ContainsKey("Expires"));
    }
}
