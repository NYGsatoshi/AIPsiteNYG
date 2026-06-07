using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

public interface ITenantPlanRepository
{
    Task<TenantSettings?> GetTenantSettingsAsync(Guid tenantId, CancellationToken cancellationToken = default);

    Task<TenantSettings> GetOrCreateTenantSettingsAsync(Guid tenantId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Plan>> ListPlansAsync(CancellationToken cancellationToken = default);

    Task<Plan?> GetPlanAsync(Guid planId, CancellationToken cancellationToken = default);

    Task AddPlanAsync(Plan plan, CancellationToken cancellationToken = default);

    Task<Subscription?> GetActiveSubscriptionAsync(Guid tenantId, CancellationToken cancellationToken = default);

    Task<Subscription?> GetSubscriptionAsync(Guid subscriptionId, CancellationToken cancellationToken = default);

    Task AddSubscriptionAsync(Subscription subscription, CancellationToken cancellationToken = default);

    Task<TenantUsageSnapshot> GetCurrentUsageAsync(Guid tenantId, CancellationToken cancellationToken = default);
}
