using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Web.Testing;

internal static class BrowserSmokeNotificationFixtureSeed
{
    private const string RevocationGroupSlug = "browser-smoke-pr04-queue";

    public static async Task EnsureRevocableProjectAccessAsync(
        AppDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken = default)
    {
        var group = await dbContext.Groups.SingleOrDefaultAsync(candidate =>
            candidate.TenantId == tenantId &&
            candidate.Slug == RevocationGroupSlug &&
            candidate.Status == GroupStatus.Active &&
            candidate.DeletedAt == null,
            cancellationToken);
        if (group is null)
        {
            throw new InvalidOperationException(
                "The PR07-D browser-smoke revocation Group fixture is missing or inactive.");
        }

        var project = await dbContext.Projects.SingleOrDefaultAsync(candidate =>
            candidate.TenantId == tenantId &&
            candidate.Slug == BrowserSmokeNotificationFixture.ProjectSlug &&
            candidate.Status == ProjectStatus.Active &&
            candidate.DeletedAt == null,
            cancellationToken);
        if (project is null)
        {
            throw new InvalidOperationException(
                "The PR07-D browser-smoke notification Project fixture is missing or inactive.");
        }

        var normalizedRecipientEmail = BrowserSmokeNotificationFixture.RecipientEmail.ToUpperInvariant();
        var recipient = await dbContext.Users.SingleOrDefaultAsync(candidate =>
            candidate.NormalizedEmail == normalizedRecipientEmail &&
            candidate.Status == UserStatus.Active &&
            candidate.DeletedAt == null,
            cancellationToken);
        if (recipient is null)
        {
            throw new InvalidOperationException(
                "The PR07-D browser-smoke notification recipient fixture is missing or inactive.");
        }

        var hasDirectProjectAccess = await dbContext.ProjectMembers.AnyAsync(candidate =>
            candidate.TenantId == tenantId &&
            candidate.ProjectId == project.Id &&
            candidate.UserId == recipient.Id,
            cancellationToken);
        if (!hasDirectProjectAccess)
        {
            throw new InvalidOperationException(
                "The PR07-D browser-smoke recipient must start with direct Project membership.");
        }

        // Ungrouped Projects intentionally inherit Workspace visibility. The
        // PR07-D revocation scenario must therefore be group-scoped so deleting
        // the recipient's direct ProjectMember is a real authorization loss.
        project.GroupId = group.Id;

        var recipientGroupMember = await dbContext.GroupMembers.FirstOrDefaultAsync(candidate =>
            candidate.TenantId == tenantId &&
            candidate.GroupId == group.Id &&
            candidate.UserId == recipient.Id,
            cancellationToken);
        if (recipientGroupMember is not null)
        {
            dbContext.GroupMembers.Remove(recipientGroupMember);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
