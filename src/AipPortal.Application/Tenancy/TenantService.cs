using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Tenancy;

public sealed class TenantService(
    ITenantRepository tenantRepository,
    ITenantAuthorizationService tenantAuthorization,
    ICurrentTenant currentTenant,
    ICurrentUser currentUser,
    IUnitOfWork unitOfWork,
    TenancyOptions options) : ITenantService
{
    public async Task<Result<IReadOnlyList<TenantResponse>>> ListPlatformTenantsAsync(CancellationToken cancellationToken = default)
    {
        if (!await IsPlatformAdminAsync(cancellationToken))
        {
            return Result<IReadOnlyList<TenantResponse>>.Failure("PlatformAdmin access is required.");
        }

        var tenants = await tenantRepository.ListTenantsAsync(cancellationToken);
        return Result<IReadOnlyList<TenantResponse>>.Success(tenants.Select(ToTenantResponse).ToList());
    }

    public async Task<Result<TenantResponse>> CreateTenantAsync(CreateTenantRequest request, CancellationToken cancellationToken = default)
    {
        if (!await IsPlatformAdminAsync(cancellationToken))
        {
            return Result<TenantResponse>.Failure("PlatformAdmin access is required.");
        }

        var slug = NormalizeSlug(request.Slug);
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(slug))
        {
            return Result<TenantResponse>.Failure("Tenant name and slug are required.");
        }

        if (await tenantRepository.GetTenantBySlugAsync(slug, cancellationToken) is not null)
        {
            return Result<TenantResponse>.Failure("Tenant slug is already in use.");
        }

        var primaryDomain = NormalizeOptional(request.PrimaryDomain);
        if (primaryDomain is not null &&
            await tenantRepository.GetTenantByPrimaryDomainAsync(primaryDomain, cancellationToken) is not null)
        {
            return Result<TenantResponse>.Failure("Tenant primary domain is already in use.");
        }

        var tenant = new Tenant
        {
            Name = request.Name.Trim(),
            Slug = slug,
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? request.Name.Trim() : request.DisplayName.Trim(),
            PrimaryDomain = primaryDomain,
            PlanId = NormalizeOptional(request.PlanId),
            Status = TenantStatus.Active
        };

        await tenantRepository.AddTenantAsync(tenant, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<TenantResponse>.Success(ToTenantResponse(tenant));
    }

    public async Task<Result<TenantResponse>> GetPlatformTenantAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        if (!await IsPlatformAdminAsync(cancellationToken))
        {
            return Result<TenantResponse>.Failure("PlatformAdmin access is required.");
        }

        var tenant = await tenantRepository.GetTenantAsync(tenantId, cancellationToken);
        return tenant is null
            ? Result<TenantResponse>.Failure("Tenant not found.")
            : Result<TenantResponse>.Success(ToTenantResponse(tenant));
    }

    public async Task<Result<TenantResponse>> UpdateTenantAsync(Guid tenantId, UpdateTenantRequest request, CancellationToken cancellationToken = default)
    {
        if (!await IsPlatformAdminAsync(cancellationToken))
        {
            return Result<TenantResponse>.Failure("PlatformAdmin access is required.");
        }

        var tenant = await tenantRepository.GetTenantAsync(tenantId, cancellationToken);
        if (tenant is null)
        {
            return Result<TenantResponse>.Failure("Tenant not found.");
        }

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            tenant.Name = request.Name.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.DisplayName))
        {
            tenant.DisplayName = request.DisplayName.Trim();
        }

        if (request.PrimaryDomain is not null)
        {
            var primaryDomain = NormalizeOptional(request.PrimaryDomain);
            if (primaryDomain is not null)
            {
                var existing = await tenantRepository.GetTenantByPrimaryDomainAsync(primaryDomain, cancellationToken);
                if (existing is not null && existing.Id != tenant.Id)
                {
                    return Result<TenantResponse>.Failure("Tenant primary domain is already in use.");
                }
            }

            tenant.PrimaryDomain = primaryDomain;
        }

        if (request.PlanId is not null)
        {
            tenant.PlanId = NormalizeOptional(request.PlanId);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<TenantResponse>.Success(ToTenantResponse(tenant));
    }

    public Task<Result> SuspendTenantAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        return SetTenantStatusAsync(tenantId, TenantStatus.Suspended, cancellationToken);
    }

    public Task<Result> ActivateTenantAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        return SetTenantStatusAsync(tenantId, TenantStatus.Active, cancellationToken);
    }

    public Task<Result> ArchiveTenantAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        return SetTenantStatusAsync(tenantId, TenantStatus.Archived, cancellationToken);
    }

    public Task<Result<CurrentTenantResponse>> GetCurrentTenantAsync(CancellationToken cancellationToken = default)
    {
        if (!currentTenant.IsAvailable)
        {
            return Task.FromResult(Result<CurrentTenantResponse>.Failure("Tenant is not available for this request."));
        }

        return Task.FromResult(Result<CurrentTenantResponse>.Success(new CurrentTenantResponse(
            currentTenant.TenantId,
            currentTenant.TenantSlug,
            currentTenant.IsAvailable,
            currentTenant.IsPlatformScope)));
    }

    public async Task<Result<IReadOnlyList<TenantResponse>>> ListMyTenantsAsync(CancellationToken cancellationToken = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Result<IReadOnlyList<TenantResponse>>.Failure("Authentication is required.");
        }

        var memberships = await tenantRepository.ListUserTenantMembershipsAsync(userId, cancellationToken);
        var tenants = memberships
            .Where(membership => membership is { Status: TenantUserStatus.Active, Tenant.Status: TenantStatus.Active })
            .Select(membership => membership.Tenant!)
            .DistinctBy(tenant => tenant.Id)
            .Select(ToTenantResponse)
            .ToList();

        return Result<IReadOnlyList<TenantResponse>>.Success(tenants);
    }

    public async Task<Result<TenantResponse>> SwitchTenantAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        if (!options.AllowTenantSwitching || options.AppMode == AppMode.OnPremSingleTenant)
        {
            return Result<TenantResponse>.Failure("Tenant switching is disabled.");
        }

        if (!TryGetUserId(out var userId))
        {
            return Result<TenantResponse>.Failure("Authentication is required.");
        }

        if (!await tenantAuthorization.CanSwitchTenantAsync(userId, tenantId, cancellationToken))
        {
            return Result<TenantResponse>.Failure("Tenant membership is required.");
        }

        var tenant = await tenantRepository.GetTenantAsync(tenantId, cancellationToken);
        return tenant is null || tenant.Status != TenantStatus.Active
            ? Result<TenantResponse>.Failure("Tenant is not available.")
            : Result<TenantResponse>.Success(ToTenantResponse(tenant));
    }

    public async Task<Result<IReadOnlyList<TenantUserResponse>>> ListCurrentTenantUsersAsync(CancellationToken cancellationToken = default)
    {
        if (!await CanManageCurrentTenantAsync(cancellationToken))
        {
            return Result<IReadOnlyList<TenantUserResponse>>.Failure("Tenant Owner or Admin access is required.");
        }

        var users = await tenantRepository.ListTenantUsersAsync(currentTenant.TenantId, cancellationToken);
        return Result<IReadOnlyList<TenantUserResponse>>.Success(users.Select(ToTenantUserResponse).ToList());
    }

    public async Task<Result<TenantUserResponse>> AddCurrentTenantUserAsync(AddTenantUserRequest request, CancellationToken cancellationToken = default)
    {
        if (!await CanManageCurrentTenantAsync(cancellationToken))
        {
            return Result<TenantUserResponse>.Failure("Tenant Owner or Admin access is required.");
        }

        var user = await tenantRepository.GetUserAsync(request.UserId, cancellationToken);
        if (user is null || user.DeletedAt.HasValue)
        {
            return Result<TenantUserResponse>.Failure("User not found.");
        }

        var existing = await tenantRepository.GetTenantUserAsync(currentTenant.TenantId, request.UserId, cancellationToken);
        if (existing is { Status: TenantUserStatus.Active })
        {
            return Result<TenantUserResponse>.Failure("User is already an active member of this tenant.");
        }

        var tenantUser = existing ?? new TenantUser
        {
            TenantId = currentTenant.TenantId,
            UserId = request.UserId,
            JoinedAt = DateTimeOffset.UtcNow,
            InvitedByUserId = currentUser.UserId
        };

        tenantUser.Role = request.Role;
        tenantUser.Status = TenantUserStatus.Active;

        if (existing is null)
        {
            await tenantRepository.AddTenantUserAsync(tenantUser, cancellationToken);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        tenantUser.User = user;
        return Result<TenantUserResponse>.Success(ToTenantUserResponse(tenantUser));
    }

    public async Task<Result<TenantUserResponse>> UpdateCurrentTenantUserAsync(Guid userId, UpdateTenantUserRequest request, CancellationToken cancellationToken = default)
    {
        if (!await CanManageCurrentTenantAsync(cancellationToken))
        {
            return Result<TenantUserResponse>.Failure("Tenant Owner or Admin access is required.");
        }

        var tenantUser = await tenantRepository.GetTenantUserAsync(currentTenant.TenantId, userId, cancellationToken);
        if (tenantUser is null)
        {
            return Result<TenantUserResponse>.Failure("Tenant user not found.");
        }

        if (request.Role.HasValue)
        {
            tenantUser.Role = request.Role.Value;
        }

        if (request.Status.HasValue)
        {
            tenantUser.Status = request.Status.Value;
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<TenantUserResponse>.Success(ToTenantUserResponse(tenantUser));
    }

    public async Task<Result> RemoveCurrentTenantUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (!await CanManageCurrentTenantAsync(cancellationToken))
        {
            return Result.Failure("Tenant Owner or Admin access is required.");
        }

        var tenantUser = await tenantRepository.GetTenantUserAsync(currentTenant.TenantId, userId, cancellationToken);
        if (tenantUser is null)
        {
            return Result.Failure("Tenant user not found.");
        }

        tenantUser.Status = TenantUserStatus.Left;
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<Result> SetTenantStatusAsync(Guid tenantId, TenantStatus status, CancellationToken cancellationToken)
    {
        if (!await IsPlatformAdminAsync(cancellationToken))
        {
            return Result.Failure("PlatformAdmin access is required.");
        }

        var tenant = await tenantRepository.GetTenantAsync(tenantId, cancellationToken);
        if (tenant is null)
        {
            return Result.Failure("Tenant not found.");
        }

        tenant.Status = status;
        if (status == TenantStatus.Archived || status == TenantStatus.Deleted)
        {
            tenant.MarkDeleted(DateTimeOffset.UtcNow);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<bool> CanManageCurrentTenantAsync(CancellationToken cancellationToken)
    {
        return currentTenant.IsAvailable &&
               TryGetUserId(out var userId) &&
               await tenantAuthorization.CanManageTenantAsync(userId, currentTenant.TenantId, cancellationToken);
    }

    private Task<bool> IsPlatformAdminAsync(CancellationToken cancellationToken)
    {
        return TryGetUserId(out var userId)
            ? tenantAuthorization.IsPlatformAdminAsync(userId, cancellationToken)
            : Task.FromResult(false);
    }

    private bool TryGetUserId(out Guid userId)
    {
        if (currentUser.IsAuthenticated && currentUser.UserId.HasValue)
        {
            userId = currentUser.UserId.Value;
            return true;
        }

        userId = Guid.Empty;
        return false;
    }

    private static TenantResponse ToTenantResponse(Tenant tenant)
    {
        return new TenantResponse(
            tenant.Id,
            tenant.Name,
            tenant.Slug,
            tenant.DisplayName,
            tenant.PrimaryDomain,
            tenant.Status,
            tenant.PlanId,
            tenant.CreatedAt,
            tenant.UpdatedAt,
            tenant.DeletedAt);
    }

    private static TenantUserResponse ToTenantUserResponse(TenantUser tenantUser)
    {
        return new TenantUserResponse(
            tenantUser.Id,
            tenantUser.TenantId,
            tenantUser.UserId,
            tenantUser.User?.DisplayName ?? string.Empty,
            tenantUser.User?.Email ?? string.Empty,
            tenantUser.Role,
            tenantUser.Status,
            tenantUser.JoinedAt,
            tenantUser.InvitedByUserId);
    }

    private static string NormalizeSlug(string slug)
    {
        return slug.Trim().ToLowerInvariant();
    }

    private static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();
    }
}
