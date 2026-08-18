using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Realtime;
using AipPortal.Application.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

/// <summary>
/// Canonical Workspace-scoped Project create command (WPC-DEC-031).
/// This service intentionally owns only Draft/Planning creation. First activation,
/// ProjectGeneral provisioning and Task workflow provisioning belong to WPC-02D.
/// </summary>
public sealed class CanonicalProjectCreateService(
    IProjectRepository projects,
    IWorkspaceRepository workspaces,
    IGroupRepository groups,
    ITenantRepository tenants,
    ICapabilityGrantEvaluator capabilityGrants,
    ICurrentUser currentUser,
    ICurrentTenant currentTenant,
    IClock clock,
    IAuditLogger auditLogger,
    IAuthorizationStateChangePublisher authorizationChanges,
    ICreateIdempotencyCoordinator createIdempotency) : ICanonicalProjectCreateService
{
    private const string ProjectCreateOperation = "Project.Create.v1";

    public async Task<Result<CanonicalProjectCreateResponse>> CreateAsync(
        Guid workspaceId,
        CanonicalCreateProjectRequest request,
        string? clientRequestIdentity,
        CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Failure("AuthenticationRequired", "Authentication is required.");
        }

        if (currentTenant is not { IsAvailable: true, IsPlatformScope: false } || currentTenant.TenantId == Guid.Empty)
        {
            return Failure("TenantMembershipRequired", "An active Tenant membership is required.");
        }

        var tenantId = currentTenant.TenantId;
        var tenantMembership = await tenants.GetTenantUserAsync(tenantId, userId, cancellationToken);
        if (tenantMembership is not { Status: TenantUserStatus.Active })
        {
            return Failure("TenantMembershipRequired", "An active Tenant membership is required.");
        }

        var tenant = tenantMembership.Tenant ?? await tenants.GetTenantAsync(tenantId, cancellationToken);
        var user = tenantMembership.User ?? await tenants.GetUserAsync(userId, cancellationToken);
        if (tenant is not { Status: TenantStatus.Active, DeletedAt: null } ||
            user is not { Status: UserStatus.Active, DeletedAt: null })
        {
            return Failure("TenantMembershipRequired", "An active Tenant membership is required.");
        }

        if (workspaceId == Guid.Empty)
        {
            return NotFound();
        }

        var workspace = await workspaces.GetByIdAsync(workspaceId, cancellationToken);
        if (workspace is null ||
            workspace.TenantId != tenantId ||
            workspace.DeletedAt.HasValue ||
            workspace.Status == WorkspaceStatus.Deleted)
        {
            return NotFound();
        }

        var workspaceMembership = await workspaces.GetMemberAsync(workspaceId, userId, cancellationToken);
        if (workspaceMembership is not { Status: MembershipStatus.Active } || workspaceMembership.TenantId != tenantId)
        {
            // No platform role, including SystemAdmin, substitutes for current
            // active Workspace membership on this command.
            return NotFound();
        }

        if (workspace.Status != WorkspaceStatus.Active)
        {
            return Failure(
                "InvalidStateTransition",
                "Archived Workspaces are read-only.",
                "workspace.status");
        }

        var normalizedTitle = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedTitle))
        {
            return ValidationFailure("Project title is required.", "body.title");
        }
        if (normalizedTitle.Length > 200)
        {
            return ValidationFailure("Project title must not exceed 200 characters.", "body.title");
        }

        var description = NormalizeOptional(request.Description);
        if (description?.Length > 4000)
        {
            return ValidationFailure("Project description must not exceed 4000 characters.", "body.description");
        }
        if (request.GroupId == Guid.Empty)
        {
            return ValidationFailure("GroupId must be a non-empty identifier when supplied.", "body.groupId");
        }
        if (request.StartDate.HasValue && request.EndDate.HasValue && request.EndDate.Value < request.StartDate.Value)
        {
            return ValidationFailure("Project end date cannot be before the start date.", "body.endDate");
        }

        var visibility = request.Visibility ?? ProjectVisibility.MembersOnly;
        if (!Enum.IsDefined(typeof(ProjectVisibility), visibility))
        {
            return ValidationFailure("Project visibility is invalid.", "body.visibility");
        }

        Group? group = null;
        GroupMember? groupMembership = null;
        if (request.GroupId.HasValue)
        {
            group = await groups.GetByIdAsync(request.GroupId.Value, cancellationToken);
            if (group is null ||
                group.TenantId != tenantId ||
                group.WorkspaceId != workspaceId ||
                group.DeletedAt.HasValue ||
                group.Status != GroupStatus.Active)
            {
                return NotFound();
            }

            groupMembership = await groups.GetMemberAsync(group.Id, userId, cancellationToken);
        }

        var hasWorkspaceGovernanceAuthority = workspaceMembership.Role.CanManage();
        var hasDelegatedCreate = await HasScopedCapabilityAsync(
            userId,
            tenantId,
            workspaceId,
            CapabilityKeys.ProjectCreate,
            cancellationToken);
        var managesBoundGroup = group is not null && groupMembership?.Role.CanManage() == true;

        if (!hasWorkspaceGovernanceAuthority && !hasDelegatedCreate && !managesBoundGroup)
        {
            return Failure("CapabilityDenied", "You are not allowed to create projects in this Workspace.", "workspace");
        }

        if (visibility != ProjectVisibility.MembersOnly)
        {
            var hasVisibilityAuthority = hasWorkspaceGovernanceAuthority ||
                                         await HasScopedCapabilityAsync(
                                             userId,
                                             tenantId,
                                             workspaceId,
                                             CapabilityKeys.ProjectVisibilityManage,
                                             cancellationToken);
            if (!hasVisibilityAuthority)
            {
                return Failure(
                    "CapabilityDenied",
                    "You are not allowed to select a non-default Project visibility.",
                    "body.visibility");
            }
        }

        if (clientRequestIdentity is null)
        {
            return Failure(
                "MissingIdempotencyKey",
                "An Idempotency-Key header is required.",
                "header.Idempotency-Key");
        }
        if (!IsValidClientRequestIdentity(clientRequestIdentity))
        {
            return Failure(
                "InvalidIdempotencyKey",
                "The Idempotency-Key header is invalid.",
                "header.Idempotency-Key");
        }

        var project = new Project
        {
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            GroupId = group?.Id,
            OwnerUserId = userId,
            Name = normalizedTitle,
            Description = description,
            Status = ProjectStatus.Planning,
            Visibility = visibility,
            ActivationState = ProjectActivationState.NeverActivated,
            ActivatedAtUtc = null,
            ActivationVersion = null,
            SuspendedFromStatus = null,
            ArchivedFromStatus = null,
            StartDate = request.StartDate,
            DueDate = request.EndDate,
            VersionNo = 1,
            CreatedByUserId = userId
        };
        project.Slug = CreateProjectSlug(normalizedTitle, project.Id);

        IdempotentCreateResult<Project> idempotency;
        try
        {
            idempotency = await createIdempotency.ExecuteAsync(
                new CreateIdempotencyContext(
                    tenantId,
                    userId,
                    ProjectCreateOperation,
                    clientRequestIdentity,
                    CreateRequestFingerprint(
                        workspaceId,
                        group?.Id,
                        normalizedTitle,
                        description,
                        visibility,
                        request.StartDate,
                        request.EndDate),
                    "Project",
                    project.Id),
                async token =>
                {
                    await projects.AddProjectAsync(project, token);
                    await projects.AddMemberAsync(new ProjectMember
                    {
                        TenantId = tenantId,
                        ProjectId = project.Id,
                        UserId = userId,
                        Role = ProjectRole.Owner,
                        JoinedAt = clock.UtcNow
                    }, token);
                    await auditLogger.LogAsync(
                        new AuditLogEntry(
                            userId,
                            "ProjectCreated",
                            "Project",
                            project.Id,
                            WorkspaceId: workspaceId,
                            GroupId: group?.Id,
                            ProjectId: project.Id,
                            TenantId: tenantId),
                        token);
                    await authorizationChanges.PublishAsync(
                        tenantId,
                        userId,
                        "Project",
                        project.Id,
                        "granted",
                        token);
                    return project;
                },
                async (resourceId, token) =>
                {
                    var committed = await projects.GetProjectAsync(resourceId, token);
                    if (committed is null ||
                        committed.TenantId != tenantId ||
                        committed.WorkspaceId != workspaceId ||
                        committed.DeletedAt.HasValue ||
                        committed.Status == ProjectStatus.Deleted ||
                        !committed.Visibility.HasValue)
                    {
                        return null;
                    }

                    var currentWorkspaceMembership = await workspaces.GetMemberAsync(workspaceId, userId, token);
                    var currentProjectMembership = await projects.GetMemberAsync(resourceId, userId, token);
                    return currentWorkspaceMembership is { Status: MembershipStatus.Active } && currentProjectMembership is not null
                        ? committed
                        : null;
                },
                cancellationToken);
        }
        catch (RequiredOutboxStagingException)
        {
            return Failure("DependencyUnavailable", "Project creation is temporarily unavailable.");
        }

        return idempotency.Disposition switch
        {
            IdempotentCreateDisposition.Created or IdempotentCreateDisposition.Replayed
                when idempotency.Value is not null => Result<CanonicalProjectCreateResponse>.Success(ToResponse(idempotency.Value)),
            IdempotentCreateDisposition.RequestMismatch => Failure(
                "IdempotencyConflict",
                "The Idempotency-Key was already used with a different Project request.",
                "header.Idempotency-Key"),
            _ => NotFound()
        };
    }

    private async Task<bool> HasScopedCapabilityAsync(
        Guid userId,
        Guid tenantId,
        Guid workspaceId,
        string capabilityKey,
        CancellationToken cancellationToken)
    {
        if (await capabilityGrants.HasActiveGrantAsync(
                userId,
                tenantId,
                capabilityKey,
                CapabilityScopeType.Workspace,
                workspaceId,
                cancellationToken))
        {
            return true;
        }

        return await capabilityGrants.HasActiveGrantAsync(
            userId,
            tenantId,
            capabilityKey,
            CapabilityScopeType.Tenant,
            tenantId,
            cancellationToken);
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue && userId != Guid.Empty;
    }

    private static string? NormalizeOptional(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }

    private static bool IsValidClientRequestIdentity(string value) =>
        value.Length is >= 8 and <= 128 &&
        !string.IsNullOrWhiteSpace(value) &&
        value.All(character => character is >= ' ' and <= '~');

    private static string CreateRequestFingerprint(
        Guid workspaceId,
        Guid? groupId,
        string title,
        string? description,
        ProjectVisibility visibility,
        DateOnly? startDate,
        DateOnly? endDate)
    {
        var canonical = string.Concat(
            EncodeFingerprintPart(workspaceId.ToString("D")),
            EncodeFingerprintPart(groupId?.ToString("D")),
            EncodeFingerprintPart(title),
            EncodeFingerprintPart(description),
            EncodeFingerprintPart(visibility.ToString()),
            EncodeFingerprintPart(startDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            EncodeFingerprintPart(endDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static string EncodeFingerprintPart(string? value) =>
        value is null ? "-1:" : $"{Encoding.UTF8.GetByteCount(value)}:{value}";

    private static string CreateProjectSlug(string title, Guid projectId)
    {
        const int maxLength = 140;
        var suffix = projectId.ToString("N")[..12];
        var prefix = SlugGenerator.FromName(title);
        var maxPrefixLength = maxLength - suffix.Length - 1;
        if (prefix.Length > maxPrefixLength)
        {
            prefix = prefix[..maxPrefixLength].Trim('-');
        }
        if (string.IsNullOrWhiteSpace(prefix))
        {
            prefix = "project";
        }
        return $"{prefix}-{suffix}";
    }

    private static CanonicalProjectCreateResponse ToResponse(Project project) => new(
        project.Id,
        project.WorkspaceId,
        project.GroupId,
        project.OwnerUserId,
        project.Name,
        project.Description,
        project.Status,
        project.Visibility!.Value,
        project.ActivationState,
        project.StartDate,
        project.DueDate,
        project.VersionNo,
        project.CreatedAt);

    private static Result<CanonicalProjectCreateResponse> ValidationFailure(string message, string target) =>
        Failure("ValidationFailed", message, target);

    private static Result<CanonicalProjectCreateResponse> NotFound() =>
        Failure("NotFound", "The requested resource was not found.");

    private static Result<CanonicalProjectCreateResponse> Failure(string code, string message, string? target = null) =>
        Result<CanonicalProjectCreateResponse>.Failure(new ApplicationErrorDetail(code, message, Target: target));
}
