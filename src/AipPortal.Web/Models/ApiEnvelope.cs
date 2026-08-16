using System.Diagnostics;
using System.Text.Json.Serialization;
using AipPortal.Application.Security.Redaction;

namespace AipPortal.Web.Models;

public sealed record ApiSuccessEnvelope<T>(
    [property: JsonPropertyName("requestId")] string RequestId,
    [property: JsonPropertyName("data")] T Data,
    [property: JsonPropertyName("warnings")] IReadOnlyList<object> Warnings);

public sealed record ApiErrorEnvelope(
    [property: JsonPropertyName("requestId")] string RequestId,
    [property: JsonPropertyName("error")] ApiErrorBody Error,
    [property: JsonPropertyName("traceId")] string TraceId,
    [property: JsonPropertyName("status")] int Status);

public sealed record ApiErrorBody(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("target")] string? Target,
    [property: JsonPropertyName("details")] IReadOnlyList<object> Details,
    [property: JsonPropertyName("redactionApplied")] bool RedactionApplied);

/// <summary>
/// Common WPC API envelope factory. Error payloads always pass through the
/// canonical ErrorResponse redaction profile. Existing callers may set
/// redactionApplied=true to classify their supplied content as sensitive; the
/// emitted flag is still derived from whether canonical redaction changed the
/// response rather than copied from that request.
/// </summary>
public static class ApiEnvelope
{
    public static ApiSuccessEnvelope<T> Success<T>(HttpContext context, T data) =>
        new(context.TraceIdentifier, data, Array.Empty<object>());

    public static ApiErrorEnvelope Error(
        HttpContext context,
        int status,
        string code,
        string message,
        string? target = null,
        bool redactionApplied = false,
        AuthorizationContext? authorizationContext = null)
    {
        var redactionService =
            context.RequestServices.GetService(typeof(IRedactionService)) as IRedactionService ??
            new CanonicalRedactionService();

        var redactionContext = authorizationContext ?? new AuthorizationContext(
            ActorId: null,
            TenantId: null,
            ModuleKey: "WpcEnvelope",
            Purpose: "NormalOperation",
            RequestId: context.TraceIdentifier,
            AuthorizationState: RedactionAuthorizationState.Unknown);

        var source = new ErrorRedactionSource(
            code,
            message,
            target,
            Array.Empty<object>(),
            redactionApplied ? RedactionSensitivity.Sensitive : RedactionSensitivity.PublicSafe);

        var result = redactionService.Redact(
            redactionContext,
            source,
            RedactionProfile.ErrorResponse);

        if (result.Value is not ErrorRedactionSource redacted)
        {
            throw new InvalidOperationException("Canonical ErrorResponse redaction returned an invalid payload type.");
        }

        return new ApiErrorEnvelope(
            context.TraceIdentifier,
            new ApiErrorBody(
                redacted.Code,
                redacted.Message,
                redacted.Target,
                redacted.Details,
                result.RedactionApplied),
            Activity.Current?.Id ?? context.TraceIdentifier,
            status);
    }

    public static bool IsWorkspaceCreationPath(string? path)
    {
        var normalized = path?.TrimEnd('/') ?? string.Empty;
        return normalized.Equals("/api/workspaces", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("/api/workspaces/capabilities", StringComparison.OrdinalIgnoreCase);
    }
}
