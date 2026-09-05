using System.ComponentModel.DataAnnotations;

namespace AipPortal.Application.Auth;

public sealed record RegisterByInviteRequest(
    [Required, RegularExpression("^[a-f0-9]{64}$")]
    string InviteToken,
    [Required]
    string DisplayName,
    [Required, EmailAddress]
    string Email,
    [Required, MinLength(8)]
    string Password);

public sealed record AcceptInviteRequest(
    [Required, RegularExpression("^[a-f0-9]{64}$")]
    string Token,
    [Required]
    string DisplayName,
    [Required, MinLength(8)]
    string Password);

public sealed record InviteValidationResponse(
    bool Valid,
    string Email,
    string Role,
    string TenantName,
    string WorkspaceName,
    DateTimeOffset ExpiresAt);
