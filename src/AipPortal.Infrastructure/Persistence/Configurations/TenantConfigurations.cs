using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class TenantConfiguration : IEntityTypeConfiguration<Tenant>
{
    public void Configure(EntityTypeBuilder<Tenant> builder)
    {
        builder.ToTable("tenants");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(tenant => tenant.Name).HasMaxLength(160).IsRequired();
        builder.Property(tenant => tenant.Slug).HasMaxLength(120).IsRequired();
        builder.Property(tenant => tenant.DisplayName).HasMaxLength(160).IsRequired();
        builder.Property(tenant => tenant.PrimaryDomain).HasMaxLength(260);
        builder.Property(tenant => tenant.Status).HasEnumStringConversion().IsRequired();
        builder.Property(tenant => tenant.PlanId).HasMaxLength(120);

        builder.HasIndex(tenant => tenant.Slug).IsUnique();
        builder.HasIndex(tenant => tenant.PrimaryDomain).IsUnique();
        builder.HasIndex(tenant => tenant.Status);
    }
}

public sealed class TenantUserConfiguration : IEntityTypeConfiguration<TenantUser>
{
    public void Configure(EntityTypeBuilder<TenantUser> builder)
    {
        builder.ToTable("tenant_users");
        builder.ConfigureAuditableEntity();

        builder.Property(user => user.Role).HasEnumStringConversion().IsRequired();
        builder.Property(user => user.Status).HasEnumStringConversion().IsRequired();
        builder.Property(user => user.JoinedAt).IsRequired();

        builder.HasIndex(user => user.UserId);
        builder.HasIndex(user => user.Status);
        builder.HasIndex(user => new { user.TenantId, user.UserId, user.Status });

        builder
            .HasIndex(user => new { user.TenantId, user.UserId })
            .IsUnique()
            .HasFilter("\"Status\" = 'Active'");

        builder
            .HasOne(user => user.Tenant)
            .WithMany(tenant => tenant.Users)
            .HasForeignKey(user => user.TenantId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(user => user.User)
            .WithMany()
            .HasForeignKey(user => user.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(user => user.InvitedByUser)
            .WithMany()
            .HasForeignKey(user => user.InvitedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
