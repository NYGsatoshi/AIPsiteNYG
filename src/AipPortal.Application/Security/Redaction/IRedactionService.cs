using System.Text.Json;
using System.Text.Json.Nodes;

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

public enum RedactionPurpose
{
    NormalOperation,
    ApprovalReview,
    FileDownload,
    ExportBuild,
    SecurityAuditLite
}

/// <summary>
/// Canonical redaction input context. Authorization is supplied by the caller;
/// the redaction layer never invents or upgrades a business authorization decision.
/// Purpose is restricted to the canonical MVP vocabulary.
/// </summary>
public sealed record AuthorizationContext
{
    public Guid? ActorId { get; }
    public Guid? TenantId { get; }
    public string ModuleKey { get; }
    public RedactionPurpose Purpose { get; }
    public string RequestId { get; }
    public RedactionAuthorizationState AuthorizationState { get; }

    public AuthorizationContext(
        Guid? ActorId,
        Guid? TenantId,
        string ModuleKey,
        RedactionPurpose Purpose,
        string RequestId,
        RedactionAuthorizationState AuthorizationState)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(ModuleKey);
        ArgumentException.ThrowIfNullOrWhiteSpace(RequestId);

        this.ActorId = ActorId;
        this.TenantId = TenantId;
        this.ModuleKey = ModuleKey;
        this.Purpose = Purpose;
        this.RequestId = RequestId;
        this.AuthorizationState = AuthorizationState;
    }

    public AuthorizationContext(
        Guid? ActorId,
        Guid? TenantId,
        string ModuleKey,
        string Purpose,
        string RequestId,
        RedactionAuthorizationState AuthorizationState)
        : this(
            ActorId,
            TenantId,
            ModuleKey,
            ParsePurpose(Purpose),
            RequestId,
            AuthorizationState)
    {
    }

    private static RedactionPurpose ParsePurpose(string purpose)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(purpose);
        if (Enum.TryParse<RedactionPurpose>(purpose, ignoreCase: false, out var parsed) &&
            Enum.IsDefined(parsed))
        {
            return parsed;
        }

        throw new ArgumentOutOfRangeException(
            nameof(purpose),
            purpose,
            "Redaction purpose must use the canonical MVP vocabulary.");
    }
}

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
/// Marker returned when a non-error profile is invoked without an affirmative
/// authorization decision. Endpoint boundaries must reject this marker rather
/// than serializing it as application data.
/// </summary>
public sealed record RedactedPayload(RedactionProfile Profile, string Reason);

public sealed class CanonicalRedactionService : IRedactionService
{
    private const string SafeErrorMessage = "The request could not be completed.";
    private const string RestrictedMarker = "[redacted:restricted]";

    private static readonly JsonSerializerOptions ProjectionJson =
        new(JsonSerializerDefaults.Web);

    private static readonly HashSet<string> AlwaysRemoveFields = Set(
        "password",
        "passwordhash",
        "secret",
        "clientsecret",
        "webhooksecret",
        "rawtoken",
        "tokenhash",
        "credential",
        "credentialvalue",
        "authorization",
        "cookie",
        "storagekey",
        "hashsha256",
        "apikey",
        "privatekey");

    private static readonly HashSet<string> AlwaysRestrictedFields = Set(
        "healthnotes",
        "medicalnotes",
        "guardiancontact",
        "securitysetting",
        "securitysettings",
        "audittdetail",
        "auditdetail",
        "rightsevidence");

    private static readonly IReadOnlyDictionary<RedactionProfile, HashSet<string>> ProfileRestrictedFields =
        new Dictionary<RedactionProfile, HashSet<string>>
        {
            [RedactionProfile.UiList] = Set(
                "email",
                "originalfilename",
                "uploadedbydisplayname"),
            [RedactionProfile.UiDetail] = Set(
                "email",
                "originalfilename",
                "uploadedbydisplayname"),
            [RedactionProfile.SearchSnippet] = Set(
                "email",
                "snippet",
                "body",
                "content",
                "description",
                "summary"),
            [RedactionProfile.ExportRow] = Set(
                "email",
                "primarydomain",
                "originalfilename",
                "filename",
                "uploadedbyuserid",
                "uploadedbydisplayname",
                "body",
                "content",
                "message",
                "description",
                "summary",
                "metadata",
                "details",
                "ipaddress",
                "useragent",
                "deletereason",
                "token"),
            [RedactionProfile.AuditDisplay] = Set(
                "summary",
                "metadata",
                "details",
                "ipaddress",
                "useragent",
                "body",
                "content",
                "description"),
            [RedactionProfile.NotificationPayload] = Set(
                "email",
                "body",
                "content",
                "message",
                "summary",
                "description"),
            [RedactionProfile.FileMetadata] = Set(
                "originalfilename",
                "filename",
                "uploadedbyuserid",
                "uploadedbydisplayname",
                "uploader",
                "targetlabel")
        };

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

        var serialized = JsonSerializer.SerializeToNode(
            source,
            source.GetType(),
            ProjectionJson)
            ?? throw new InvalidOperationException(
                "Canonical redaction could not serialize the response projection source.");

        var changed = false;
        var projected = ProjectNode(serialized, context, profile, ref changed)
            ?? throw new InvalidOperationException(
                "Canonical redaction returned a null response projection.");

        return changed
            ? new RedactionResult(projected, RedactionApplied: true)
            : new RedactionResult(source, RedactionApplied: false);
    }

    private static JsonNode? ProjectNode(
        JsonNode? node,
        AuthorizationContext context,
        RedactionProfile profile,
        ref bool changed)
    {
        if (node is JsonObject sourceObject)
        {
            var projected = new JsonObject();
            foreach (var property in sourceObject)
            {
                var normalizedName = NormalizeFieldName(property.Key);
                if (ShouldRemove(context, profile, normalizedName))
                {
                    changed = true;
                    continue;
                }

                if (ShouldRedact(profile, normalizedName))
                {
                    projected[property.Key] = RedactedValue(property.Value, normalizedName);
                    changed = true;
                    continue;
                }

                projected[property.Key] = ProjectNode(
                    property.Value,
                    context,
                    profile,
                    ref changed);
            }

            return projected;
        }

        if (node is JsonArray sourceArray)
        {
            var projected = new JsonArray();
            foreach (var item in sourceArray)
            {
                projected.Add(ProjectNode(item, context, profile, ref changed));
            }

            return projected;
        }

        return node?.DeepClone();
    }

    private static bool ShouldRemove(
        AuthorizationContext context,
        RedactionProfile profile,
        string normalizedName)
    {
        if (AlwaysRemoveFields.Contains(normalizedName))
        {
            return true;
        }

        if (normalizedName == "token" &&
            profile == RedactionProfile.UiDetail &&
            string.Equals(context.ModuleKey, "FileDownloadGrant", StringComparison.Ordinal))
        {
            return false;
        }

        return false;
    }

    private static bool ShouldRedact(
        RedactionProfile profile,
        string normalizedName)
    {
        if (AlwaysRestrictedFields.Contains(normalizedName))
        {
            return true;
        }

        return ProfileRestrictedFields.TryGetValue(profile, out var fields) &&
               fields.Contains(normalizedName);
    }

    private static JsonNode? RedactedValue(JsonNode? value, string normalizedName)
    {
        if (normalizedName.Contains("email", StringComparison.Ordinal))
        {
            return JsonValue.Create("[redacted:email]");
        }

        if (normalizedName.Contains("filename", StringComparison.Ordinal))
        {
            return JsonValue.Create("[redacted:file]");
        }

        if (value is JsonValue scalar && scalar.TryGetValue<string>(out _))
        {
            return JsonValue.Create(RestrictedMarker);
        }

        return null;
    }

    private static string NormalizeFieldName(string name) =>
        name.Replace("_", string.Empty, StringComparison.Ordinal)
            .Replace("-", string.Empty, StringComparison.Ordinal)
            .ToLowerInvariant();

    private static HashSet<string> Set(params string[] values) =>
        new(values.Select(NormalizeFieldName), StringComparer.Ordinal);

    private static RedactionResult RedactError(AuthorizationContext context, object source)
    {
        if (source is not ErrorRedactionSource error)
        {
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
                      error.Details.Count != 0;

        return new RedactionResult(redacted, RedactionApplied: changed);
    }
}
