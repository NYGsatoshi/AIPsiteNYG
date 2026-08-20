using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Security.Redaction;
using Microsoft.Extensions.DependencyInjection;

namespace AipPortal.Web.Security;

/// <summary>
/// Applies one canonical redaction profile at an HTTP response boundary.
///
/// The caller must supply the authorization state that was established by the
/// application use case. This helper never infers or upgrades that decision:
/// an unknown or denied state must therefore return an endpoint-compatible
/// projection from the canonical service, or the request fails closed.
/// </summary>
public static class CanonicalRedactionProjection
{
    public static T Apply<T>(
        HttpContext httpContext,
        T source,
        RedactionProfile profile,
        string moduleKey,
        RedactionAuthorizationState authorizationState,
        string purpose = "NormalOperation")
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(moduleKey);
        ArgumentException.ThrowIfNullOrWhiteSpace(purpose);

        var requestServices = httpContext.RequestServices
            ?? throw new InvalidOperationException(
                "Canonical redaction requires a configured request service provider.");
        var currentUser = requestServices.GetService(typeof(ICurrentUser)) as ICurrentUser;
        var currentTenant = requestServices.GetService(typeof(ICurrentTenant)) as ICurrentTenant;
        var context = new AuthorizationContext(
            ActorId: currentUser?.UserId,
            TenantId: currentTenant is { IsAvailable: true } ? currentTenant.TenantId : null,
            ModuleKey: moduleKey,
            Purpose: purpose,
            RequestId: httpContext.TraceIdentifier,
            AuthorizationState: authorizationState);

        var redactionService = requestServices.GetRequiredService<IRedactionService>();
        var result = redactionService.Redact(context, source!, profile);

        if (result.Value is T projected)
        {
            return projected;
        }

        throw new InvalidOperationException(
            "Canonical redaction did not return an endpoint-compatible response projection.");
    }
}
