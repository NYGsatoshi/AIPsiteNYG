namespace AipPortal.Application.Auth;

public sealed record RegisterByInviteRequest(
    string InviteToken,
    string DisplayName,
    string Email,
    string Password);
