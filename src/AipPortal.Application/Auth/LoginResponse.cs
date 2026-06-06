using AipPortal.Domain.Enums;

namespace AipPortal.Application.Auth;

public sealed record LoginResponse(
    Guid UserId,
    Guid SessionId,
    string DisplayName,
    string Email,
    SystemRole SystemRole,
    DateTimeOffset ExpiresAt);
