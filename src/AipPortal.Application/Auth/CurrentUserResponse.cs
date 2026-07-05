using AipPortal.Domain.Enums;

namespace AipPortal.Application.Auth;

public sealed record CurrentUserResponse(
    Guid UserId,
    string DisplayName,
    string Email,
    SystemRole SystemRole,
    UserStatus Status,
    IReadOnlyList<string> Capabilities);
