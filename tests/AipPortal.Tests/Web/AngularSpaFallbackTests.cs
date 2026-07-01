using System.Net;
using AipPortal.Web;
using Microsoft.AspNetCore.Http;

namespace AipPortal.Tests.Web;

public sealed class AngularSpaFallbackTests : IDisposable
{
    private readonly string webRootPath = Path.Combine(Path.GetTempPath(), "aip-angular-fallback-tests", Guid.NewGuid().ToString("N"));

    public AngularSpaFallbackTests()
    {
        Directory.CreateDirectory(webRootPath);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/login")]
    [InlineData("/register/invite")]
    [InlineData("/workspaces")]
    [InlineData("/projects")]
    [InlineData("/conversations")]
    [InlineData("/admin")]
    [InlineData("/account")]
    [InlineData("/files")]
    [InlineData("/notifications")]
    public void UserFacingRoutesCanFallBackToAngularWhenBuildExists(string path)
    {
        WriteAngularBuild();
        var context = CreateContext(path);

        Assert.True(AngularSpaFallback.CanServeAngularFallback(context.Request, webRootPath));
    }

    [Theory]
    [InlineData("/api/not-found")]
    [InlineData("/health")]
    [InlineData("/health/live")]
    [InlineData("/healthz")]
    [InlineData("/metrics")]
    [InlineData("/swagger/index.html")]
    [InlineData("/hangfire/jobs")]
    [InlineData("/signin-google")]
    [InlineData("/auth/callback/google")]
    [InlineData("/favicon.ico")]
    public void BackendOwnedRoutesDoNotFallBackToAngular(string path)
    {
        WriteAngularBuild();
        var context = CreateContext(path);

        Assert.False(AngularSpaFallback.CanServeAngularFallback(context.Request, webRootPath));
    }

    [Fact]
    public void UserFacingRoutesDoNotFallBackToLegacyWwwrootWithoutAngularMarker()
    {
        File.WriteAllText(Path.Combine(webRootPath, "index.html"), "<html>legacy</html>");
        var context = CreateContext("/login");

        Assert.False(AngularSpaFallback.CanServeAngularFallback(context.Request, webRootPath));
    }

    [Fact]
    public void StaticAssetMissesDoNotFallBackToAngular()
    {
        WriteAngularBuild();
        var context = CreateContext("/assets/missing.js");

        Assert.False(AngularSpaFallback.CanServeAngularFallback(context.Request, webRootPath));
    }

    [Fact]
    public async Task UnknownApiRoutesReturnJsonNotAngularIndex()
    {
        WriteAngularBuild();
        var context = CreateContext("/api/not-found");
        context.Response.Body = new MemoryStream();

        await AngularSpaFallback.HandleAsync(context, webRootPath);

        context.Response.Body.Position = 0;
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();

        Assert.Equal((int)HttpStatusCode.NotFound, context.Response.StatusCode);
        Assert.Contains("application/json", context.Response.ContentType);
        Assert.Contains("\"code\":\"NotFound\"", body);
        Assert.DoesNotContain("Angular", body, StringComparison.OrdinalIgnoreCase);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(webRootPath))
            {
                Directory.Delete(webRootPath, recursive: true);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }

    private void WriteAngularBuild()
    {
        File.WriteAllText(Path.Combine(webRootPath, "index.html"), "<html>Angular</html>");
        File.WriteAllText(Path.Combine(webRootPath, AngularSpaFallback.BuildMarkerFileName), "marker");
    }

    private static DefaultHttpContext CreateContext(string path, string method = "GET")
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        return context;
    }
}
