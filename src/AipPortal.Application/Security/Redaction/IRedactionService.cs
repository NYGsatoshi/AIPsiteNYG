namespace AipPortal.Application.Security.Redaction;

public interface IRedactionService
{
    RedactionResult Redact(AuthorizationContext context, object source, RedactionProfile profile);
}

public enum RedactionProfile
{
    UiList,
    UiDetail,
    SearchSnippet,
    ExportRow,
    AuditDisplay,
    NotificationPayload,
    FileMetadata,
    ErrorResponse
}

public enum RedactionAuthorizationState
{
    Allowed,
    Denied,
    Unknown
}

/// <summary>
/// Canonical redaction input context. Authorization is supplied by the caller;
/// the redaction layer never invents or upgrades a business authorization decision.
/// </summary>
public sealed record AuthorizationContext(
    Guid? ActorId,
    Guid? TenantId,
    string ModuleKey,
    string Purpose,
    string RequestId,
    RedactionAuthorizationState AuthorizationState);

public sealed record RedactionResult(object Value, bool RedactionApplied);

public enum RedactionSensitivity
{
    PublicSafe,
    Sensitive
}

/// <summary>
/// Transport-neutral source used by the ErrorResponse profile.
/// PublicSafe means every supplied field is intentionally safe for disclosure.
/// Sensitive content is disclosed only when the caller supplies an Allowed decision.
/// </summary>
public sealed record ErrorRedactionSource(
    string Code,
    string Message,
    string? Target,
    IReadOnlyList<object> Details,
    RedactionSensitivity Sensitivity = RedactionSensitivity.PublicSafe);

/// <summary>
/// Marker returned when a not-yet-adopted profile is invoked without an
/// affirmative authorization decision. This prevents unknown/denied state from
/// silently passing the original source through while later WPC work adds the
/// profile-specific projections.
/// </summary>
public sealed record RedactedPayload(RedactionProfile Profile, string Reason);

public sealed class CanonicalRedactionService : IRedactionService
{
    private const string SafeErrorMessage = "The request could not be completed.";

    public RedactionResult Redact(
        AuthorizationContext context,
        object source,
        RedactionProfile profile)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(source);

        if (profile == RedactionProfile.ErrorResponse)
        {
            return RedactError(context, source);
        }

        if (context.AuthorizationState != RedactionAuthorizationState.Allowed)
        {
            return new RedactionResult(
                new RedactedPayload(profile, "authorization"),
                RedactionApplied: true);
        }

        // WPC-02E-1 establishes the canonical dependency/profile surface only.
        // Profile-specific DTO projections are adopted by the follow-up work;
        // an affirmative authorization decision may therefore pass through here.
        return new RedactionResult(source, RedactionApplied: false);
    }

    private static RedactionResult RedactError(AuthorizationContext context, object source)
    {
        if (source is not ErrorRedactionSource error)
        {
            // ErrorResponse has a concrete canonical source contract. Refuse an
            // unknown shape instead of guessing which fields are safe.
            throw new ArgumentException(
                $"{nameof(RedactionProfile.ErrorResponse)} requires {nameof(ErrorRedactionSource)}.",
                nameof(source));
        }

        if (error.Sensitivity == RedactionSensitivity.PublicSafe ||
            context.AuthorizationState == RedactionAuthorizationState.Allowed)
        {
            return new RedactionResult(error, RedactionApplied: false);
        }

        var redacted = error with
        {
            Message = SafeErrorMessage,
            Target = null,
            Details = Array.Empty<object>(),
            Sensitivity = RedactionSensitivity.PublicSafe
        };

        var changed = !string.Equals(error.Message, redacted.Message, StringComparison.Ordinal) ||
                      error.Target is not null ||
                      error.Details.Count != 0 ||
                      error.Sensitivity != redacted.Sensitivity;

        return new RedactionResult(redacted, RedactionApplied: changed);
    }
}
