using System.Text.Json.Serialization;
using AipPortal.Application.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

public interface ICanonicalProjectCreateService
{
    Task<Result<CanonicalProjectCreateResponse>> CreateAsync(
        Guid workspaceId,
        CanonicalCreateProjectRequest request,
        string? clientRequestIdentity,
        CancellationToken cancellationToken = default);
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CanonicalCreateProjectRequest(
    [property: JsonRequired] string Title,
    string? Description = null,
    Guid? GroupId = null,
    ProjectVisibility? Visibility = null,
    DateOnly? StartDate = null,
    DateOnly? EndDate = null);

public sealed record CanonicalProjectCreateResponse(
    Guid Id,
    Guid WorkspaceId,
    Guid? GroupId,
    Guid OwnerUserId,
    string Title,
    string? Description,
    ProjectStatus Status,
    ProjectVisibility Visibility,
    ProjectActivationState ActivationState,
    DateOnly? StartDate,
    DateOnly? EndDate,
    long VersionNo,
    DateTimeOffset CreatedAt);
