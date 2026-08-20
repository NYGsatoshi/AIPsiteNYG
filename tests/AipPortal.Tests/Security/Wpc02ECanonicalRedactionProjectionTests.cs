using System.Text.Json;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Middleware;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace AipPortal.Tests.Security;

[Trait("Scope", "WPC02E")]
public sealed class Wpc02ECanonicalRedactionProjectionTests
{
    [Theory]
    [InlineData(RedactionProfile.UiList)]
    [InlineData(RedactionProfile.UiDetail)]
    [InlineData(RedactionProfile.SearchSnippet)]
    [InlineData(RedactionProfile.ExportRow)]
    [InlineData(RedactionProfile.AuditDisplay)]
    [InlineData(RedactionProfile.NotificationPayload)]
    [InlineData(RedactionProfile.FileMetadata)]
    public void AuthorizedProjection_UsesTheDeclaredCanonicalProfile(
        RedactionProfile profile)
    {
        var redactor = new RecordingRedactionService();
        var httpContext = CreateHttpContext(redactor);
        var source = new ProjectionProbe("authorized output");

        var projected = CanonicalRedactionProjection.Apply(
            httpContext,
            source,
            profile,
            "Wpc02ETest");

        Assert.Same(source, projected);
        Assert.Equal(profile, redactor.Profile);
        Assert.NotNull(redactor.Context);
        Assert.Equal(RedactionAuthorizationState.Allowed, redactor.Context!.AuthorizationState);
        Assert.Equal("Wpc02ETest", redactor.Context.ModuleKey);
        Assert.Equal(httpContext.TraceIdentifier, redactor.Context.RequestId);
    }

    [Fact]
    public void AuthorizedProjection_FailsClosed_WhenTheCanonicalServiceCannotReturnTheEndpointContract()
    {
        var httpContext = CreateHttpContext(new ClosedRedactionService());
        var source = new ProjectionProbe("must not pass through");

        Assert.Throws<InvalidOperationException>(() =>
            CanonicalRedactionProjection.Apply(
                httpContext,
                source,
                RedactionProfile.UiDetail,
                "Wpc02ETest"));
    }

    [Theory]
    [InlineData("/api/workspaces")]
    [InlineData("/api/workspaces/00000000-0000-0000-0000-000000000001/projects")]
    [InlineData("/api/projects/00000000-0000-0000-0000-000000000001/activate")]
    public async Task WpcContractMiddleware_UsesTheCanonicalErrorEnvelopeForEveryWpcCommandRoute(
        string path)
    {
        var nextCalled = false;
        var middleware = new WpcApiContractMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });
        var httpContext = new DefaultHttpContext
        {
            TraceIdentifier = "wpc02e-415",
            Response = { Body = new MemoryStream() }
        };
        httpContext.Request.Method = HttpMethods.Post;
        httpContext.Request.Path = path;
        httpContext.Request.ContentType = "text/plain";

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.Body.Position = 0;
        using var payload = await JsonDocument.ParseAsync(httpContext.Response.Body);
        Assert.False(nextCalled);
        Assert.Equal(StatusCodes.Status415UnsupportedMediaType, httpContext.Response.StatusCode);
        Assert.Equal("wpc02e-415", payload.RootElement.GetProperty("requestId").GetString());
        Assert.Equal(415, payload.RootElement.GetProperty("status").GetInt32());
        Assert.Equal(
            "UnsupportedMediaType",
            payload.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    private static DefaultHttpContext CreateHttpContext(IRedactionService redactor)
    {
        var services = new ServiceCollection()
            .AddSingleton<IRedactionService>(redactor)
            .BuildServiceProvider();

        return new DefaultHttpContext
        {
            TraceIdentifier = "wpc02e-projection",
            RequestServices = services
        };
    }

    private sealed record ProjectionProbe(string Value);

    private sealed class RecordingRedactionService : IRedactionService
    {
        public AuthorizationContext? Context { get; private set; }

        public RedactionProfile? Profile { get; private set; }

        public RedactionResult Redact(
            AuthorizationContext context,
            object source,
            RedactionProfile profile)
        {
            Context = context;
            Profile = profile;
            return new RedactionResult(source, RedactionApplied: false);
        }
    }

    private sealed class ClosedRedactionService : IRedactionService
    {
        public RedactionResult Redact(
            AuthorizationContext context,
            object source,
            RedactionProfile profile) =>
            new(new RedactedPayload(profile, "authorization"), RedactionApplied: true);
    }
}
