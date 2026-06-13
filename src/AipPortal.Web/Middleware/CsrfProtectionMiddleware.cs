using AipPortal.Web.Configuration;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Extensions.Options;

namespace AipPortal.Web.Middleware;

public sealed class CsrfProtectionMiddleware(
    RequestDelegate next,
    IAntiforgery antiforgery,
    IOptions<SecurityOptions> securityOptions,
    ILogger<CsrfProtectionMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (!securityOptions.Value.EnableCsrfProtection || IsSafeMethod(context.Request.Method))
        {
            await next(context);
            return;
        }

        try
        {
            await antiforgery.ValidateRequestAsync(context);
        }
        catch (AntiforgeryValidationException ex)
        {
            logger.LogWarning(ex, "Rejected unsafe request without a valid CSRF token: {Method} {Path}", context.Request.Method, context.Request.Path);
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { error = "A valid CSRF token is required." }, context.RequestAborted);
            return;
        }

        await next(context);
    }

    private static bool IsSafeMethod(string method)
    {
        return HttpMethods.IsGet(method) ||
               HttpMethods.IsHead(method) ||
               HttpMethods.IsOptions(method) ||
               HttpMethods.IsTrace(method);
    }
}
