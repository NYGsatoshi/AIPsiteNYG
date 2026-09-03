using AipPortal.Application.Announcements;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Metadata-only engagement persistence for Announcement analytics. The store
/// deliberately reuses append-only AuditLog rows instead of copying campaign
/// content, CTA URLs, recipient names, or other presentation data.
/// </summary>
public sealed class AnnouncementEngagementStore(
    AppDbContext dbContext,
    IClock clock) : IAnnouncementEngagementStore
{
    public async Task RecordOnceAsync(
        Guid tenantId,
        Guid announcementId,
        Guid userId,
        string action,
        CancellationToken cancellationToken = default)
    {
        if (action is not AnnouncementEngagementActions.Acknowledged and not AnnouncementEngagementActions.CtaClicked)
        {
            throw new ArgumentOutOfRangeException(nameof(action), action, "Unsupported Announcement engagement action.");
        }

        var alreadyRecorded = await dbContext.AuditLogs
            .AsNoTracking()
            .AnyAsync(log =>
                log.TenantId == tenantId &&
                log.ActorUserId == userId &&
                log.Action == action &&
                log.EntityType == "Announcement" &&
                log.EntityId == announcementId,
                cancellationToken);
        if (alreadyRecorded)
        {
            return;
        }

        await dbContext.AuditLogs.AddAsync(new AuditLog
        {
            TenantId = tenantId,
            ActorUserId = userId,
            Action = action,
            EntityType = "Announcement",
            EntityId = announcementId,
            // Do not persist the Announcement body, title, CTA label/URL,
            // recipient display name, or any browser-supplied metadata here.
            Summary = null,
            MetadataJson = null,
            CreatedAt = clock.UtcNow
        }, cancellationToken);
    }

    public async Task<AnnouncementEngagementAggregate> GetAggregateAsync(
        Guid tenantId,
        Guid announcementId,
        IReadOnlyCollection<Guid> recipientUserIds,
        CancellationToken cancellationToken = default)
    {
        var recipientIds = recipientUserIds.Distinct().ToArray();
        var hasFrozenDeliveryCohort = await dbContext.AuditLogs
            .AsNoTracking()
            .AnyAsync(log =>
                log.TenantId == tenantId &&
                log.Action == AnnouncementDistributionContract.FrozenCohortAuditAction &&
                log.EntityType == "Announcement" &&
                log.EntityId == announcementId,
                cancellationToken);

        if (recipientIds.Length == 0)
        {
            return new AnnouncementEngagementAggregate(
                hasFrozenDeliveryCohort,
                0,
                0,
                0,
                []);
        }

        var readTimes = await dbContext.AnnouncementReads
            .AsNoTracking()
            .Where(read =>
                read.TenantId == tenantId &&
                read.AnnouncementId == announcementId &&
                recipientIds.Contains(read.UserId))
            .Select(read => read.ReadAt)
            .ToListAsync(cancellationToken);

        var engagementEvents = dbContext.AuditLogs
            .AsNoTracking()
            .Where(log =>
                log.TenantId == tenantId &&
                log.EntityType == "Announcement" &&
                log.EntityId == announcementId &&
                log.ActorUserId.HasValue &&
                recipientIds.Contains(log.ActorUserId.Value));

        // Distinct ActorUserId makes retries and a rare concurrent duplicate
        // harmless for aggregate results even though AuditLog remains append-only.
        var acknowledgedCount = await engagementEvents
            .Where(log => log.Action == AnnouncementEngagementActions.Acknowledged)
            .Select(log => log.ActorUserId)
            .Distinct()
            .CountAsync(cancellationToken);
        var ctaClickedCount = await engagementEvents
            .Where(log => log.Action == AnnouncementEngagementActions.CtaClicked)
            .Select(log => log.ActorUserId)
            .Distinct()
            .CountAsync(cancellationToken);

        return new AnnouncementEngagementAggregate(
            hasFrozenDeliveryCohort,
            readTimes.Count,
            acknowledgedCount,
            ctaClickedCount,
            readTimes);
    }
}
