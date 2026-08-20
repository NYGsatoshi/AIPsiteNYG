using AipPortal.Application.Common;
using AipPortal.Web.Models;

namespace AipPortal.Web.Security;

/// <summary>
/// Converts a result failure into the canonical ErrorResponse profile without
/// exposing unclassified application error text at an HTTP boundary.
/// </summary>
public static class CanonicalErrorEnvelope
{
    public static ApiErrorEnvelope FromSensitiveResult(
        HttpContext httpContext,
        int status,
        ApplicationErrorDetail? detail,
        string? fallbackError,
        string fallbackCode,
        string fallbackMessage = "The request could not be completed.")
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentException.ThrowIfNullOrWhiteSpace(fallbackCode);
        ArgumentException.ThrowIfNullOrWhiteSpace(fallbackMessage);

        return ApiEnvelope.Error(
            httpContext,
            status,
            detail?.Code ?? fallbackCode,
            detail?.Message ?? fallbackError ?? fallbackMessage,
            detail?.Target,
            redactionApplied: true);
    }
}
