using AipPortal.Domain.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Domain.Entities;

public sealed class Tenant : SoftDeletableEntity
{
    public Tenant()
    {
    }

    public Tenant(Guid id)
    {
        Id = id;
    }

    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? PrimaryDomain { get; set; }
    public TenantStatus Status { get; set; } = TenantStatus.Active;
    public string? PlanId { get; set; }

    public ICollection<TenantUser> Users { get; } = new List<TenantUser>();
}

public sealed class TenantUser : AuditableEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public TenantUserRole Role { get; set; } = TenantUserRole.Member;
    public TenantUserStatus Status { get; set; } = TenantUserStatus.Invited;
    public DateTimeOffset JoinedAt { get; set; }
    public Guid? InvitedByUserId { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? InvitedByUser { get; set; }
}
