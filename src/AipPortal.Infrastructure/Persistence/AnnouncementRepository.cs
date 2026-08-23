using AipPortal.Application.Announcements;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class AnnouncementRepository(
    AppDbContext dbContext,
    IClock clock,
    ICurrentTenant currentTenant) : IAnnouncementRepository
{
    public async Task<PagedResponse<Announcement>> ListVisibleAsync(Guid userId, bool isSystemAdmin, AnnouncementListQuery query, CancellationToken cancellationToken = default)
    {
        var source = VisibleAnnouncements(userId, isSystemAdmin)
            .Where(announcement =>
                (!query.WorkspaceId.HasValue || announcement.WorkspaceId == query.WorkspaceId) &&
                (!query.GroupId.HasValue || announcement.GroupId == query.GroupId) &&
                (!query.ChannelId.HasValue || announcement.ChannelId == query.ChannelId))
            .OrderByDescending(announcement => announcement.IsPinned)
            .ThenByDescending(announcement => announcement.PublishedAt);

        var total = await source.CountAsync(cancellationToken);
        var items = await source
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .ToListAsync(cancellationToken);

        return new PagedResponse<Announcement>(items, query.Page, query.PageSize, total);
    }

    public Task<Announcement?> GetAsync(Guid announcementId, CancellationToken cancellationToken = default)
    {
        return dbContext.Announcements.FirstOrDefaultAsync(announcement => announcement.Id == announcementId, cancellationToken);
    }

    public Task<bool> IsVisibleToUserAsync(Guid announcementId, Guid userId, bool isSystemAdmin, CancellationToken cancellationToken = default)
    {
        return VisibleAnnouncements(userId, isSystemAdmin).AnyAsync(announcement => announcement.Id == announcementId, cancellationToken);
    }

    public Task<bool> HasReadAsync(Guid announcementId, Guid userId, CancellationToken cancellationToken = default)
    {
        return dbContext.AnnouncementReads.AnyAsync(read => read.AnnouncementId == announcementId && read.UserId == userId, cancellationToken);
    }

    public async Task AddAsync(Announcement announcement, CancellationToken cancellationToken = default)
    {
        if (announcement.TenantId == Guid.Empty)
        {
            if (!currentTenant.IsAvailable || currentTenant.IsPlatformScope)
            {
                throw new InvalidOperationException("A tenant context is required to create an announcement.");
            }

            // Stamp before any pre-save audience/invalidation query. AppDbContext
            // also enforces this tenant again at SaveChanges.
            announcement.TenantId = currentTenant.TenantId;
        }
        else if (currentTenant.IsAvailable && !currentTenant.IsPlatformScope && announcement.TenantId != currentTenant.TenantId)
        {
            throw new InvalidOperationException("Announcement TenantId does not match the current tenant context.");
        }

        await dbContext.Announcements.AddAsync(announcement, cancellationToken);
    }

    public async Task AddReadAsync(AnnouncementRead read, CancellationToken cancellationToken = default)
    {
        await dbContext.AnnouncementReads.AddAsync(read, cancellationToken);
    }

    public async Task<IReadOnlyList<AnnouncementTargetUser>> ListTargetUsersAsync(Announcement announcement, CancellationToken cancellationToken = default)
    {
        var activeTenantUserIds = dbContext.TenantUsers
            .Where(member => member.TenantId == announcement.TenantId && member.Status == TenantUserStatus.Active)
            .Select(member => member.UserId);

        IQueryable<Guid> userIds;

        if (announcement.ChannelId.HasValue)
        {
            var channel = await dbContext.Channels
                .AsNoTracking()
                .FirstOrDefaultAsync(item =>
                    item.Id == announcement.ChannelId.Value &&
                    item.TenantId == announcement.TenantId &&
                    item.DeletedAt == null &&
                    item.Status == ChannelStatus.Active,
                    cancellationToken);
            if (channel is null ||
                announcement.GroupId != channel.GroupId ||
                announcement.WorkspaceId != channel.WorkspaceId)
            {
                return [];
            }

            var groupIsActive = await dbContext.Groups.AnyAsync(group =>
                group.Id == channel.GroupId &&
                group.TenantId == announcement.TenantId &&
                group.WorkspaceId == channel.WorkspaceId &&
                group.DeletedAt == null &&
                group.Status == GroupStatus.Active,
                cancellationToken);
            var workspaceIsActive = await dbContext.Workspaces.AnyAsync(workspace =>
                workspace.Id == channel.WorkspaceId &&
                workspace.TenantId == announcement.TenantId &&
                workspace.DeletedAt == null &&
                workspace.Status == WorkspaceStatus.Active,
                cancellationToken);
            if (!groupIsActive || !workspaceIsActive)
            {
                return [];
            }

            if (channel.Type is ChannelType.Public or ChannelType.Announcement)
            {
                userIds = dbContext.GroupMembers
                    .Where(member =>
                        member.TenantId == announcement.TenantId &&
                        member.GroupId == channel.GroupId &&
                        dbContext.WorkspaceMembers.Any(workspaceMember =>
                            workspaceMember.TenantId == announcement.TenantId &&
                            workspaceMember.WorkspaceId == channel.WorkspaceId &&
                            workspaceMember.UserId == member.UserId &&
                            workspaceMember.Status == MembershipStatus.Active))
                    .Select(member => member.UserId);
            }
            else
            {
                userIds = dbContext.ChannelMembers
                    .Where(member =>
                        member.TenantId == announcement.TenantId &&
                        member.ChannelId == channel.Id &&
                        dbContext.WorkspaceMembers.Any(workspaceMember =>
                            workspaceMember.TenantId == announcement.TenantId &&
                            workspaceMember.WorkspaceId == channel.WorkspaceId &&
                            workspaceMember.UserId == member.UserId &&
                            workspaceMember.Status == MembershipStatus.Active))
                    .Select(member => member.UserId);
            }
        }
        else if (announcement.GroupId.HasValue)
        {
            var group = await dbContext.Groups
                .AsNoTracking()
                .FirstOrDefaultAsync(item =>
                    item.Id == announcement.GroupId.Value &&
                    item.TenantId == announcement.TenantId &&
                    item.DeletedAt == null &&
                    item.Status == GroupStatus.Active,
                    cancellationToken);
            if (group is null || announcement.WorkspaceId != group.WorkspaceId)
            {
                return [];
            }

            var workspaceIsActive = await dbContext.Workspaces.AnyAsync(workspace =>
                workspace.Id == group.WorkspaceId &&
                workspace.TenantId == announcement.TenantId &&
                workspace.DeletedAt == null &&
                workspace.Status == WorkspaceStatus.Active,
                cancellationToken);
            if (!workspaceIsActive)
            {
                return [];
            }

            userIds = dbContext.GroupMembers
                .Where(member =>
                    member.TenantId == announcement.TenantId &&
                    member.GroupId == group.Id &&
                    dbContext.WorkspaceMembers.Any(workspaceMember =>
                        workspaceMember.TenantId == announcement.TenantId &&
                        workspaceMember.WorkspaceId == group.WorkspaceId &&
                        workspaceMember.UserId == member.UserId &&
                        workspaceMember.Status == MembershipStatus.Active))
                .Select(member => member.UserId);
        }
        else if (announcement.WorkspaceId.HasValue)
        {
            var workspaceIsActive = await dbContext.Workspaces.AnyAsync(workspace =>
                workspace.Id == announcement.WorkspaceId.Value &&
                workspace.TenantId == announcement.TenantId &&
                workspace.DeletedAt == null &&
                workspace.Status == WorkspaceStatus.Active,
                cancellationToken);
            if (!workspaceIsActive)
            {
                return [];
            }

            userIds = dbContext.WorkspaceMembers
                .Where(member =>
                    member.TenantId == announcement.TenantId &&
                    member.WorkspaceId == announcement.WorkspaceId.Value &&
                    member.Status == MembershipStatus.Active)
                .Select(member => member.UserId);
        }
        else
        {
            userIds = activeTenantUserIds;
        }

        userIds = userIds
            .Where(userId => activeTenantUserIds.Contains(userId))
            .Distinct();

        return await dbContext.Users
            .Where(user =>
                userIds.Contains(user.Id) &&
                user.Status == UserStatus.Active &&
                user.DeletedAt == null)
            .Select(user => new AnnouncementTargetUser(
                user.Id,
                user.DisplayName,
                user.Email,
                dbContext.AnnouncementReads.Any(read => read.AnnouncementId == announcement.Id && read.UserId == user.Id)))
            .OrderBy(user => user.DisplayName)
            .ToListAsync(cancellationToken);
    }

    public Task<int> CountReadsAsync(Guid announcementId, CancellationToken cancellationToken = default)
    {
        return dbContext.AnnouncementReads.CountAsync(read => read.AnnouncementId == announcementId, cancellationToken);
    }

    private IQueryable<Announcement> VisibleAnnouncements(Guid userId, bool isSystemAdmin)
    {
        var now = clock.UtcNow;
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
            (!announcement.ChannelId.HasValue &&
             !announcement.GroupId.HasValue &&
             !announcement.WorkspaceId.HasValue &&
             dbContext.TenantUsers.Any(member =>
                 member.TenantId == announcement.TenantId &&
                 member.UserId == userId &&
                 member.Status == TenantUserStatus.Active)) ||
            (announcement.ChannelId.HasValue &&
             announcement.GroupId.HasValue &&
             announcement.WorkspaceId.HasValue &&
             dbContext.Channels.Any(channel =>
                 channel.Id == announcement.ChannelId.Value &&
                 channel.TenantId == announcement.TenantId &&
                 channel.GroupId == announcement.GroupId.Value &&
                 channel.WorkspaceId == announcement.WorkspaceId.Value &&
                 channel.DeletedAt == null &&
                 channel.Status == ChannelStatus.Active &&
                 dbContext.Groups.Any(group =>
                     group.Id == channel.GroupId &&
                     group.TenantId == announcement.TenantId &&
                     group.WorkspaceId == channel.WorkspaceId &&
                     group.DeletedAt == null &&
                     group.Status == GroupStatus.Active) &&
                 dbContext.Workspaces.Any(workspace =>
                     workspace.Id == channel.WorkspaceId &&
                     workspace.TenantId == announcement.TenantId &&
                     workspace.DeletedAt == null &&
                     workspace.Status == WorkspaceStatus.Active) &&
                 dbContext.WorkspaceMembers.Any(workspaceMember =>
                     workspaceMember.TenantId == announcement.TenantId &&
                     workspaceMember.WorkspaceId == channel.WorkspaceId &&
                     workspaceMember.UserId == userId &&
                     workspaceMember.Status == MembershipStatus.Active) &&
                 ((channel.Type == ChannelType.Public || channel.Type == ChannelType.Announcement)
                     ? dbContext.GroupMembers.Any(groupMember =>
                         groupMember.TenantId == announcement.TenantId &&
                         groupMember.GroupId == channel.GroupId &&
                         groupMember.UserId == userId)
                     : dbContext.ChannelMembers.Any(channelMember =>
                         channelMember.TenantId == announcement.TenantId &&
                         channelMember.ChannelId == channel.Id &&
                         channelMember.UserId == userId)))) ||
            (!announcement.ChannelId.HasValue &&
             announcement.GroupId.HasValue &&
             announcement.WorkspaceId.HasValue &&
             dbContext.Groups.Any(group =>
                 group.Id == announcement.GroupId.Value &&
                 group.TenantId == announcement.TenantId &&
                 group.WorkspaceId == announcement.WorkspaceId.Value &&
                 group.DeletedAt == null &&
                 group.Status == GroupStatus.Active &&
                 dbContext.Workspaces.Any(workspace =>
                     workspace.Id == group.WorkspaceId &&
                     workspace.TenantId == announcement.TenantId &&
                     workspace.DeletedAt == null &&
                     workspace.Status == WorkspaceStatus.Active) &&
                 dbContext.WorkspaceMembers.Any(workspaceMember =>
                     workspaceMember.TenantId == announcement.TenantId &&
                     workspaceMember.WorkspaceId == group.WorkspaceId &&
                     workspaceMember.UserId == userId &&
                     workspaceMember.Status == MembershipStatus.Active) &&
                 dbContext.GroupMembers.Any(groupMember =>
                     groupMember.TenantId == announcement.TenantId &&
                     groupMember.GroupId == group.Id &&
                     groupMember.UserId == userId))) ||
            (!announcement.ChannelId.HasValue &&
             !announcement.GroupId.HasValue &&
             announcement.WorkspaceId.HasValue &&
             dbContext.Workspaces.Any(workspace =>
                 workspace.Id == announcement.WorkspaceId.Value &&
                 workspace.TenantId == announcement.TenantId &&
                 workspace.DeletedAt == null &&
                 workspace.Status == WorkspaceStatus.Active) &&
             dbContext.WorkspaceMembers.Any(member =>
                 member.TenantId == announcement.TenantId &&
                 member.WorkspaceId == announcement.WorkspaceId.Value &&
                 member.UserId == userId &&
                 member.Status == MembershipStatus.Active)));
    }
}
