using AipPortal.Domain.Enums;

namespace AipPortal.Application.Workspaces;

public sealed record WorkspaceListItemResponse(
    Guid Id,
    string Name,
    string? Description,
    string? Icon,
    WorkspaceStatus Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record WorkspaceDetailResponse(
    Guid Id,
    string Name,
    string? Description,
    string? Icon,
    WorkspaceStatus Status,
    Guid CreatedByUserId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record CreateWorkspaceRequest(string Name, string? Description, string? Icon);

public sealed record UpdateWorkspaceRequest(string? Name, string? Description, string? Icon, WorkspaceStatus? Status);

public sealed record WorkspaceMemberResponse(
    Guid UserId,
    string DisplayName,
    string Email,
    WorkspaceRole Role,
    MembershipStatus Status,
    DateTimeOffset? JoinedAt);

public sealed record AddWorkspaceMemberRequest(Guid UserId, WorkspaceRole Role);

public sealed record UpdateWorkspaceMemberRequest(WorkspaceRole Role, MembershipStatus? Status);
