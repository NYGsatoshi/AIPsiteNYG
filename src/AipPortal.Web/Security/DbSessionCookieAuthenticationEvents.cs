using System.Security.Claims;
using AipPortal.Application.Auth;
using AipPortal.Application.Common.Interfaces;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace AipPortal.Web.Security;

public sealed class DbSessionCookieAuthenticationEvents(
    IUserSessionService userSessionService,
    ICurrentTenant currentTenant,
    ILogger<DbSessionCookieAuthenticationEvents> logger) : CookieAuthenticationEvents
{
    public override Task RedirectToLogin(RedirectContext<CookieAuthenticationOptions> context)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    }

    public override Task RedirectToAccessDenied(RedirectContext<CookieAuthenticationOptions> context)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    }

    public override async Task ValidatePrincipal(CookieValidatePrincipalContext context)
    {
        var userIdValue = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var sessionIdValue = context.Principal?.FindFirstValue("session_id");

        if (!Guid.TryParse(userIdValue, out var userId) ||
            !Guid.TryParse(sessionIdValue, out var sessionId))
        {
            await RejectAsync(context, "MissingSessionClaim");
            return;
        }

        var result = await userSessionService.ValidateSessionAsync(
            userId,
            sessionId,
            currentTenant.IsAvailable ? currentTenant.TenantId : null,
            RequiresActiveTenantMembership(context.HttpContext),
            context.HttpContext.RequestAborted);

        if (!result.IsValid)
        {
            await RejectAsync(context, result.FailureReason ?? "SessionInvalid");
        }
    }

    private static bool RequiresActiveTenantMembership(HttpContext context)
    {
        var path = context.Request.Path;
        if (!path.StartsWithSegments("/api") && !path.StartsWithSegments("/hubs"))
        {
            return false;
        }

        if (path.StartsWithSegments("/hubs"))
        {
            return true;
        }

        return !path.StartsWithSegments("/api/auth") &&
               !path.StartsWithSegments("/api/security") &&
               !path.StartsWithSegments("/api/platform") &&
               !path.StartsWithSegments("/api/tenants/my") &&
               !path.StartsWithSegments("/api/tenants/switch");
    }

    private async Task RejectAsync(CookieValidatePrincipalContext context, string reason)
    {
        logger.LogWarning("Rejecting auth cookie principal: {Reason}", reason);
        context.RejectPrincipal();
        await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    }
}
