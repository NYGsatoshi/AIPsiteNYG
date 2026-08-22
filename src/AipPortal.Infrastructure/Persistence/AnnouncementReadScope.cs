using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Canonical SQL-translatable Announcement list/detail/search scope. Audience
/// branches are mutually exclusive so a narrower Group or Channel scope can
/// never inherit visibility from its parent Workspace.
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
            return baseQuery;
        }

        return baseQuery.Where(announcement =>
            (!announcement.WorkspaceId.HasValue &&
             !announcement.GroupId.HasValue &&
             !announcement.ChannelId.HasValue) ||
            (announcement.ChannelId.HasValue &&
             dbContext.Channels.Any(channel =>
                 channel.Id == announcement.ChannelId.Value &&
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
            (!announcement.ChannelId.HasValue &&
             announcement.GroupId.HasValue &&
             dbContext.GroupMembers.Any(member =>
                 member.GroupId == announcement.GroupId.Value &&
                 member.UserId == userId)) ||
            (!announcement.ChannelId.HasValue &&
             !announcement.GroupId.HasValue &&
             announcement.WorkspaceId.HasValue &&
             dbContext.WorkspaceMembers.Any(member =>
                 member.WorkspaceId == announcement.WorkspaceId.Value &&
                 member.UserId == userId &&
                 member.Status == MembershipStatus.Active)));
    }
}
