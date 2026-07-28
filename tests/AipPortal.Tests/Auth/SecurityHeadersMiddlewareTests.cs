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
}
