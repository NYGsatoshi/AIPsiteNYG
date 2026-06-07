using AipPortal.Web.Models;

namespace AipPortal.Web.Middleware;

public sealed class GlobalExceptionHandlingMiddleware(
    RequestDelegate next,
    ILogger<GlobalExceptionHandlingMiddleware> logger,
    IHostEnvironment environment)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unhandled request exception. TraceId: {TraceId}", context.TraceIdentifier);
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/json";

            var message = environment.IsDevelopment()
                ? exception.Message
                : "An unexpected server error occurred.";

            await context.Response.WriteAsJsonAsync(new ErrorResponse("InternalServerError", message, context.TraceIdentifier));
        }
    }
}
