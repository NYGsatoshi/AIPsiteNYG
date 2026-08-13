using System.Diagnostics;
using System.Text.Json.Serialization;

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
/// Common API envelope factory. Error details are deny-by-default and callers
/// must supply only an already-safe public message. This does not replace the
/// canonical cross-module IRedactionService dependency.
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
        bool redactionApplied = false) =>
        new(
            context.TraceIdentifier,
            new ApiErrorBody(
                code,
                message,
                redactionApplied ? null : target,
                Array.Empty<object>(),
                redactionApplied),
            Activity.Current?.Id ?? context.TraceIdentifier,
            status);

    public static bool IsWorkspaceCreationPath(string? path)
    {
        var normalized = path?.TrimEnd('/') ?? string.Empty;
        return normalized.Equals("/api/workspaces", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("/api/workspaces/capabilities", StringComparison.OrdinalIgnoreCase);
    }
}
