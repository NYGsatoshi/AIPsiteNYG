using AipPortal.Web.Models;

namespace AipPortal.Web;

public static class AngularSpaFallback
{
    public const string BuildMarkerFileName = "angular-app.marker";
    public const string AppRequestPath = "/app";

    private static readonly PathString[] BackendOwnedPrefixes =
    [
        new("/api"),
        new("/health"),
        new("/healthz"),
        new("/metrics"),
        new("/swagger"),
        new("/hangfire"),
        new("/signin-google"),
        new("/auth/callback"),
        new("/favicon.ico")
    ];

    public static bool IsApiPath(PathString path) =>
        path.StartsWithSegments(new PathString("/api"), StringComparison.OrdinalIgnoreCase);

    public static bool IsBackendOwnedPath(PathString path) =>
        BackendOwnedPrefixes.Any(prefix => path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase));

    public static bool IsAppPath(PathString path) =>
        path.Equals(new PathString(AppRequestPath), StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments(new PathString(AppRequestPath), StringComparison.OrdinalIgnoreCase);

    public static bool IsAngularIndexPath(PathString path) =>
        path.Equals(new PathString($"{AppRequestPath}/index.html"), StringComparison.OrdinalIgnoreCase);

    public static bool HasAngularBuild(string webRootPath) =>
        File.Exists(Path.Combine(webRootPath, "index.html")) &&
        File.Exists(Path.Combine(webRootPath, BuildMarkerFileName));

    public static bool CanServeAngularFallback(HttpRequest request, string webRootPath) =>
        (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)) &&
        HasAngularBuild(webRootPath) &&
        IsAppPath(request.Path) &&
        !IsBackendOwnedPath(request.Path) &&
        !LooksLikeStaticAssetPath(request.Path);

    public static async Task HandleAsync(HttpContext context, string webRootPath)
    {
        if (IsApiPath(context.Request.Path))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            await context.Response.WriteAsJsonAsync(
                new ErrorResponse("NotFound", "Endpoint not found.", context.TraceIdentifier));
            return;
        }

        if (!CanServeAngularFallback(context.Request, webRootPath))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        if (HttpMethods.IsHead(context.Request.Method))
        {
            return;
        }

        await context.Response.SendFileAsync(Path.Combine(webRootPath, "index.html"));
    }

    private static bool LooksLikeStaticAssetPath(PathString path)
    {
        var value = path.Value;
        if (string.IsNullOrWhiteSpace(value) || value == "/")
        {
            return false;
        }

        var lastSegment = value[(value.LastIndexOf('/') + 1)..];
        return Path.HasExtension(lastSegment);
    }
}
