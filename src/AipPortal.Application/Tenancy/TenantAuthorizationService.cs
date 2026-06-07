using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Tenancy;

public sealed class TenantAuthorizationService(ITenantRepository tenantRepository) : ITenantAuthorizationService
{
    public async Task<bool> CanAccessTenantAsync(Guid userId, Guid tenantId, CancellationToken cancellationToken = default)
    {
        var membership = await tenantRepository.GetTenantUserAsync(tenantId, userId, cancellationToken);
        return membership is { Status: TenantUserStatus.Active };
    }

    public async Task<bool> CanManageTenantAsync(Guid userId, Guid tenantId, CancellationToken cancellationToken = default)
    {
        var membership = await tenantRepository.GetTenantUserAsync(tenantId, userId, cancellationToken);
        return membership is
        {
            Status: TenantUserStatus.Active,
            Role: TenantUserRole.Owner or TenantUserRole.Admin
        };
    }

    public async Task<bool> IsPlatformAdminAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await tenantRepository.GetUserAsync(userId, cancellationToken);
        return user is
        {
            Status: UserStatus.Active,
            DeletedAt: null,
            SystemRole: SystemRole.PlatformAdmin
        };
    }

    public Task<bool> CanSwitchTenantAsync(Guid userId, Guid tenantId, CancellationToken cancellationToken = default)
    {
        return CanAccessTenantAsync(userId, tenantId, cancellationToken);
    }
}
