using System.Text.Json;
using AipPortal.Web.Middleware;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace AipPortal.Tests.Auth;

public sealed class GlobalExceptionHandlingMiddlewareTests
{
    [Fact]
    public async Task UnhandledExceptionResponseDoesNotExposeExceptionDetails()
    {
        var middleware = new GlobalExceptionHandlingMiddleware(
            _ => throw new InvalidOperationException("Password=leaked; C:\\internal\\path; SELECT * FROM Users"),
            NullLogger<GlobalExceptionHandlingMiddleware>.Instance);
        var context = new DefaultHttpContext
        {
            TraceIdentifier = "trace-for-test",
            Response =
            {
                Body = new MemoryStream()
            }
        };

        await middleware.InvokeAsync(context);

        context.Response.Body.Position = 0;
        using var payload = await JsonDocument.ParseAsync(context.Response.Body);
        var root = payload.RootElement;

        Assert.Equal(StatusCodes.Status500InternalServerError, context.Response.StatusCode);
        Assert.Equal("InternalServerError", root.GetProperty("code").GetString());
        Assert.Equal("An unexpected server error occurred.", root.GetProperty("message").GetString());
        Assert.Equal("trace-for-test", root.GetProperty("traceId").GetString());

        var body = root.GetRawText();
        Assert.DoesNotContain("Password=", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("C:\\internal\\path", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SELECT", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("leaked", body, StringComparison.OrdinalIgnoreCase);
    }
}
