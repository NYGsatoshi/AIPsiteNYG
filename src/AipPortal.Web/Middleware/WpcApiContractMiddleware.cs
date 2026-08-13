using AipPortal.Web.Models;

namespace AipPortal.Web.Middleware;

/// <summary>
/// Rejects unsupported media types at the WPC boundary before MVC generates
/// its body-less 415 response.
/// </summary>
public sealed class WpcApiContractMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (!HttpMethods.IsPost(context.Request.Method) ||
            !string.Equals(
                context.Request.Path.Value?.TrimEnd('/'),
                "/api/workspaces",
                StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(context.Request.ContentType) ||
            context.Request.HasJsonContentType())
        {
            await next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status415UnsupportedMediaType;
        await context.Response.WriteAsJsonAsync(ApiEnvelope.Error(
            context,
            StatusCodes.Status415UnsupportedMediaType,
            "UnsupportedMediaType",
            "The request Content-Type is not supported.",
            "header.Content-Type"));
    }
}
