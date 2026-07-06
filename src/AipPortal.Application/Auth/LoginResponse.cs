using System.Text.Json.Serialization;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Auth;

public sealed record LoginResponse(
    Guid UserId,
    [property: JsonIgnore]
    Guid SessionId,
    string DisplayName,
    string Email,
    SystemRole SystemRole,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<string> Capabilities,
    AuthWorkspaceSummary? CurrentWorkspace,
    IReadOnlyList<AuthWorkspaceSummary> Workspaces);
