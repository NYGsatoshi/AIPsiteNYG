using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Security.Redaction;

namespace AipPortal.Web.Security;

/// <summary>
/// Applies one canonical redaction profile at an HTTP response boundary.
///
/// Callers may use this helper only after the application use case has returned
/// a successful, current authorization-scoped result. The helper deliberately
/// does not infer or upgrade business authorization; it records that completed
/// decision as <see cref="RedactionAuthorizationState.Allowed"/> and fails
/// closed if the canonical service cannot return the endpoint's declared DTO
/// shape.
/// </summary>
public static class CanonicalRedactionProjection
{
    public static T Apply<T>(
        HttpContext httpContext,
        T source,
        RedactionProfile profile,
        string moduleKey,
        string purpose = "NormalOperation")
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(moduleKey);
        ArgumentException.ThrowIfNullOrWhiteSpace(purpose);

        var currentUser = httpContext.RequestServices?.GetService(typeof(ICurrentUser)) as ICurrentUser;
        var currentTenant = httpContext.RequestServices?.GetService(typeof(ICurrentTenant)) as ICurrentTenant;
        var context = new AuthorizationContext(
            ActorId: currentUser?.UserId,
            TenantId: currentTenant is { IsAvailable: true } ? currentTenant.TenantId : null,
            ModuleKey: moduleKey,
            Purpose: purpose,
            RequestId: httpContext.TraceIdentifier,
            AuthorizationState: RedactionAuthorizationState.Allowed);

        var redactionService =
            httpContext.RequestServices?.GetService(typeof(IRedactionService)) as IRedactionService ??
            new CanonicalRedactionService();
        var result = redactionService.Redact(context, source!, profile);

        if (result.Value is T projected)
        {
            return projected;
        }

        throw new InvalidOperationException(
            "Canonical redaction did not return an endpoint-compatible response projection.");
    }
}
