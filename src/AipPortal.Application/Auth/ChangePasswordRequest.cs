namespace AipPortal.Application.Auth;

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
