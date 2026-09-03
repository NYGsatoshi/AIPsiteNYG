using AipPortal.Application.Announcements;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.Announcements;

[Trait("Scope", "Issue390")]
public sealed class AnnouncementEngagementStoreTests
{
    [Fact]
    public async Task AggregateUsesFrozenCohortDedupesRetriesAndDoesNotPersistContentMetadata()
    {
        var tenantId = Guid.NewGuid();
        var announcementId = Guid.NewGuid();
        var recipientA = Guid.NewGuid();
        var recipientB = Guid.NewGuid();
        var outsideCohort = Guid.NewGuid();
        var tenant = new CurrentTenantService();
        await using var db = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
                .Options,
            tenant);
        tenant.SetPlatformScope();
        db.Tenants.Add(new Tenant
        {
            Id = tenantId,
            Name = "Issue 390 tenant",
            DisplayName = "Issue 390 tenant",
            Slug = $"issue-390-{tenantId:N}",
            Status = TenantStatus.Active
        });
        await db.SaveChangesAsync();
        tenant.SetTenant(tenantId, $"issue-390-{tenantId:N}");

        var clock = new FixedClock(new DateTimeOffset(2026, 9, 3, 8, 0, 0, TimeSpan.Zero));
        var store = new AnnouncementEngagementStore(db, clock);

        db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            Action = AnnouncementDistributionContract.FrozenCohortAuditAction,
            EntityType = "Announcement",
            EntityId = announcementId,
            CreatedAt = clock.UtcNow
        });
        db.AnnouncementReads.Add(new AnnouncementRead
        {
            TenantId = tenantId,
            AnnouncementId = announcementId,
            UserId = recipientA,
            ReadAt = clock.UtcNow.AddMinutes(-5)
        });
        await db.SaveChangesAsync();

        await store.RecordOnceAsync(
            tenantId,
            announcementId,
            recipientA,
            AnnouncementEngagementActions.Acknowledged);
        await db.SaveChangesAsync();
        await store.RecordOnceAsync(
            tenantId,
            announcementId,
            recipientA,
            AnnouncementEngagementActions.Acknowledged);
        await store.RecordOnceAsync(
            tenantId,
            announcementId,
            recipientA,
            AnnouncementEngagementActions.CtaClicked);
        await db.SaveChangesAsync();
        await store.RecordOnceAsync(
            tenantId,
            announcementId,
            recipientA,
            AnnouncementEngagementActions.CtaClicked);
        await store.RecordOnceAsync(
            tenantId,
            announcementId,
            recipientB,
            AnnouncementEngagementActions.CtaClicked);
        await store.RecordOnceAsync(
            tenantId,
            announcementId,
            outsideCohort,
            AnnouncementEngagementActions.Acknowledged);
        await db.SaveChangesAsync();

        var aggregate = await store.GetAggregateAsync(
            tenantId,
            announcementId,
            [recipientA, recipientB]);

        Assert.True(aggregate.HasFrozenDeliveryCohort);
        Assert.Equal(1, aggregate.ReadCount);
        Assert.Equal(1, aggregate.AcknowledgedCount);
        Assert.Equal(2, aggregate.CtaClickedCount);
        Assert.Single(aggregate.ReadTimesUtc);

        var persistedEngagement = await db.AuditLogs
            .AsNoTracking()
            .Where(log =>
                log.EntityId == announcementId &&
                (log.Action == AnnouncementEngagementActions.Acknowledged ||
                 log.Action == AnnouncementEngagementActions.CtaClicked))
            .ToListAsync();
        Assert.All(persistedEngagement, log =>
        {
            Assert.Null(log.Summary);
            Assert.Null(log.MetadataJson);
        });
        Assert.DoesNotContain(persistedEngagement, log =>
            (log.Summary ?? string.Empty).Contains("body", StringComparison.OrdinalIgnoreCase));
    }

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }
}
