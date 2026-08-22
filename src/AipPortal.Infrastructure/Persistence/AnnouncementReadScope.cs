using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Canonical SQL-translatable Announcement list/detail/search scope. Audience
/// branches are mutually exclusive so a narrower Group or Channel scope can
/// never inherit visibility from its parent Workspace. Child-scope membership
/// is never sufficient by itself: the current user must still have current
/// access to the parent Workspace and all persisted scope links must agree.
/// </summary>
public static class AnnouncementReadScope
{
    public static IQueryable<Announcement> VisibleAnnouncementsFor(
        this AppDbContext dbContext,
        Guid userId,
        bool isSystemAdmin,
        DateTimeOffset now)
    {
        var baseQuery = dbContext.Announcements
            .AsNoTracking()
            .Where(announcement =>
                announcement.DeletedAt == null &&
                announcement.PublishedAt <= now &&
                (!announcement.ExpiresAt.HasValue || announcement.ExpiresAt.Value > now));

        if (isSystemAdmin)
        {
            // Preserve the existing SystemAdmin announcement-read exception.
            // Tenant isolation still comes from the AppDbContext query filter.
            return baseQuery;
        }

        var readableWorkspaceIds = dbContext.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                workspace.DeletedAt == null &&
                (workspace.Status == WorkspaceStatus.Active ||
                 workspace.Status == WorkspaceStatus.Archived) &&
                dbContext.WorkspaceMembers.Any(member =>
                    member.WorkspaceId == workspace.Id &&
                    member.UserId == userId &&
                    member.Status == MembershipStatus.Active))
            .Select(workspace => workspace.Id);

        return baseQuery.Where(announcement =>
            // Tenant-global announcement.
            (!announcement.WorkspaceId.HasValue &&
             !announcement.GroupId.HasValue &&
             !announcement.ChannelId.HasValue) ||

            // Channel-scoped announcement. Scope links, parent lifecycle,
            // current Workspace access, and the channel audience must all hold.
            (announcement.ChannelId.HasValue &&
             announcement.GroupId.HasValue &&
             announcement.WorkspaceId.HasValue &&
             dbContext.Channels.Any(channel =>
                 channel.Id == announcement.ChannelId.Value &&
                 channel.GroupId == announcement.GroupId.Value &&
                 channel.WorkspaceId == announcement.WorkspaceId.Value &&
                 channel.DeletedAt == null &&
                 channel.Status == ChannelStatus.Active &&
                 readableWorkspaceIds.Contains(channel.WorkspaceId) &&
                 dbContext.Groups.Any(group =>
                     group.Id == channel.GroupId &&
                     group.WorkspaceId == channel.WorkspaceId &&
                     group.DeletedAt == null &&
                     group.Status == GroupStatus.Active) &&
                 (((channel.Type == ChannelType.Public ||
                    channel.Type == ChannelType.Announcement) &&
                   dbContext.GroupMembers.Any(member =>
                       member.GroupId == channel.GroupId &&
                       member.UserId == userId)) ||
                  ((channel.Type == ChannelType.Private ||
                    channel.Type == ChannelType.Confidential) &&
                   dbContext.ChannelMembers.Any(member =>
                       member.ChannelId == channel.Id &&
                       member.UserId == userId))))) ||

            // Group-scoped announcement. A stale GroupMember row must never
            // survive loss of the parent Workspace authorization boundary.
            (!announcement.ChannelId.HasValue &&
             announcement.GroupId.HasValue &&
             announcement.WorkspaceId.HasValue &&
             dbContext.Groups.Any(group =>
                 group.Id == announcement.GroupId.Value &&
                 group.WorkspaceId == announcement.WorkspaceId.Value &&
                 group.DeletedAt == null &&
                 group.Status == GroupStatus.Active &&
                 readableWorkspaceIds.Contains(group.WorkspaceId) &&
                 dbContext.GroupMembers.Any(member =>
                     member.GroupId == group.Id &&
                     member.UserId == userId))) ||

            // Workspace-only announcement.
            (!announcement.ChannelId.HasValue &&
             !announcement.GroupId.HasValue &&
             announcement.WorkspaceId.HasValue &&
             readableWorkspaceIds.Contains(announcement.WorkspaceId.Value)));
    }
}
