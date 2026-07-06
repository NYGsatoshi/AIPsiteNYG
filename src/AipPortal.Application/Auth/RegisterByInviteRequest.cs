namespace AipPortal.Application.Auth;

public sealed record RegisterByInviteRequest(
    string InviteToken,
    string DisplayName,
    string Email,
    string Password);

public sealed record AcceptInviteRequest(
    string Token,
    string DisplayName,
    string Password);

public sealed record InviteValidationResponse(
    bool Valid,
    string Email,
    string Role,
    string TenantName,
    string WorkspaceName,
    DateTimeOffset ExpiresAt);
