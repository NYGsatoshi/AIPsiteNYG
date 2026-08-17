using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Tenancy;

public static class CapabilityKeys
{
    public const string WorkspaceCreate = "workspace.create";
    public const string ProjectCreate = "project.create";
    public const string ProjectVisibilityManage = "project.visibility.manage";
}

public interface ICapabilityGrantEvaluator
{
    Task<bool> HasActiveGrantAsync(
        Guid subjectUserId,
        Guid tenantId,
        string capabilityKey,
        CapabilityScopeType scopeType,
        Guid? scopeId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Authoritative current-state delegated-capability evaluator. Every decision
/// revalidates the user, Tenant membership, Tenant lifecycle and grant lifetime.
/// </summary>
public sealed class CapabilityGrantEvaluator(
    ICapabilityGrantRepository grants,
    ITenantRepository tenants,
    ICurrentTenant currentTenant,
    IClock clock) : ICapabilityGrantEvaluator
{
    public async Task<bool> HasActiveGrantAsync(
        Guid subjectUserId,
        Guid tenantId,
        string capabilityKey,
        CapabilityScopeType scopeType,
        Guid? scopeId,
        CancellationToken cancellationToken = default)
    {
        if (subjectUserId == Guid.Empty ||
            tenantId == Guid.Empty ||
            string.IsNullOrWhiteSpace(capabilityKey) ||
            currentTenant is not { IsAvailable: true, IsPlatformScope: false } ||
            currentTenant.TenantId != tenantId ||
            !IsScopeShapeValid(tenantId, scopeType, scopeId))
        {
            return false;
        }

        var membership = await tenants.GetTenantUserAsync(tenantId, subjectUserId, cancellationToken);
        if (membership is not { Status: TenantUserStatus.Active })
        {
            return false;
        }

        var tenant = membership.Tenant ?? await tenants.GetTenantAsync(tenantId, cancellationToken);
        var user = membership.User ?? await tenants.GetUserAsync(subjectUserId, cancellationToken);
        if (tenant is not { Status: TenantStatus.Active, DeletedAt: null } ||
            user is not { Status: UserStatus.Active, DeletedAt: null })
        {
            return false;
        }

        var grant = await grants.FindSlotAsync(
            tenantId,
            subjectUserId,
            capabilityKey,
            scopeType,
            scopeId,
            cancellationToken);
        if (grant is null ||
            grant.VersionNo <= 0 ||
            grant.RevokedAt.HasValue)
        {
            return false;
        }

        var now = clock.UtcNow;
        return grant.GrantedAt <= now &&
               (!grant.ExpiresAt.HasValue || grant.ExpiresAt.Value > now);
    }

    internal static bool IsScopeShapeValid(
        Guid tenantId,
        CapabilityScopeType scopeType,
        Guid? scopeId)
    {
        return scopeType switch
        {
            CapabilityScopeType.Tenant => scopeId == tenantId,
            CapabilityScopeType.Workspace => scopeId.HasValue && scopeId.Value != Guid.Empty,
            _ => false
        };
    }
}
