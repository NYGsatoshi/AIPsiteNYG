using System.ComponentModel.DataAnnotations;

namespace AipPortal.Application.Auth;

public sealed record RegisterByInviteRequest(
    [property: Required, RegularExpression("^[a-f0-9]{64}$")]
    string InviteToken,
    [property: Required]
    string DisplayName,
    [property: Required, EmailAddress]
    string Email,
    [property: Required, MinLength(8)]
    string Password);

public sealed record AcceptInviteRequest(
    [property: Required, RegularExpression("^[a-f0-9]{64}$")]
    string Token,
    [property: Required]
    string DisplayName,
    [property: Required, MinLength(8)]
    string Password);

public sealed record InviteValidationResponse(
    bool Valid,
    string Email,
    string Role,
    string TenantName,
    string WorkspaceName,
    DateTimeOffset ExpiresAt);
