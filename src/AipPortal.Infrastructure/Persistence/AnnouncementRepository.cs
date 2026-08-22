using AipPortal.Application.Announcements;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class AnnouncementRepository(AppDbContext dbContext, IClock clock) : IAnnouncementRepository
{
    public async Task<PagedResponse<Announcement>> ListVisibleAsync(Guid userId, bool isSystemAdmin, AnnouncementListQuery query, CancellationToken cancellationToken = default)
    {
        var source = dbContext.VisibleAnnouncementsFor(userId, isSystemAdmin, clock.UtcNow)
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
        return dbContext.VisibleAnnouncementsFor(userId, isSystemAdmin, clock.UtcNow)
            .AnyAsync(announcement => announcement.Id == announcementId, cancellationToken);
    }

    public Task<bool> HasReadAsync(Guid announcementId, Guid userId, CancellationToken cancellationToken = default)
    {
        return dbContext.AnnouncementReads.AnyAsync(read => read.AnnouncementId == announcementId && read.UserId == userId, cancellationToken);
    }

    public async Task AddAsync(Announcement announcement, CancellationToken cancellationToken = default)
    {
        await dbContext.Announcements.AddAsync(announcement, cancellationToken);
    }

    public async Task AddReadAsync(AnnouncementRead read, CancellationToken cancellationToken = default)
    {
        await dbContext.AnnouncementReads.AddAsync(read, cancellationToken);
    }

    public async Task<IReadOnlyList<AnnouncementTargetUser>> ListTargetUsersAsync(Announcement announcement, CancellationToken cancellationToken = default)
    {
        IQueryable<User> users;

        if (announcement.ChannelId.HasValue)
        {
            if (!announcement.WorkspaceId.HasValue || !announcement.GroupId.HasValue)
            {
                return [];
            }

            var channel = await dbContext.Channels
                .AsNoTracking()
                .Where(item =>
                    item.Id == announcement.ChannelId.Value &&
                    item.WorkspaceId == announcement.WorkspaceId.Value &&
                    item.GroupId == announcement.GroupId.Value &&
                    item.DeletedAt == null &&
                    item.Status == ChannelStatus.Active &&
                    dbContext.Groups.Any(group =>
                        group.Id == item.GroupId &&
                        group.WorkspaceId == item.WorkspaceId &&
                        group.DeletedAt == null &&
                        group.Status == GroupStatus.Active) &&
                    dbContext.Workspaces.Any(workspace =>
                        workspace.Id == item.WorkspaceId &&
                        workspace.DeletedAt == null &&
                        (workspace.Status == WorkspaceStatus.Active ||
                         workspace.Status == WorkspaceStatus.Archived)))
                .Select(item => new { item.Id, item.GroupId, item.WorkspaceId, item.Type })
                .FirstOrDefaultAsync(cancellationToken);
            if (channel is null)
            {
                return [];
            }

            var currentWorkspaceUserIds = CurrentWorkspaceUserIds(channel.WorkspaceId);
            users = channel.Type is ChannelType.Public or ChannelType.Announcement
                ? dbContext.GroupMembers
                    .Where(member =>
                        member.GroupId == channel.GroupId &&
                        currentWorkspaceUserIds.Contains(member.UserId))
                    .Select(member => member.User!)
                : dbContext.ChannelMembers
                    .Where(member =>
                        member.ChannelId == channel.Id &&
                        currentWorkspaceUserIds.Contains(member.UserId))
                    .Select(member => member.User!);
        }
        else if (announcement.GroupId.HasValue)
        {
            if (!announcement.WorkspaceId.HasValue)
            {
                return [];
            }

            var group = await dbContext.Groups
                .AsNoTracking()
                .Where(item =>
                    item.Id == announcement.GroupId.Value &&
                    item.WorkspaceId == announcement.WorkspaceId.Value &&
                    item.DeletedAt == null &&
                    item.Status == GroupStatus.Active &&
                    dbContext.Workspaces.Any(workspace =>
                        workspace.Id == item.WorkspaceId &&
                        workspace.DeletedAt == null &&
                        (workspace.Status == WorkspaceStatus.Active ||
                         workspace.Status == WorkspaceStatus.Archived)))
                .Select(item => new { item.Id, item.WorkspaceId })
                .FirstOrDefaultAsync(cancellationToken);
            if (group is null)
            {
                return [];
            }

            var currentWorkspaceUserIds = CurrentWorkspaceUserIds(group.WorkspaceId);
            users = dbContext.GroupMembers
                .Where(member =>
                    member.GroupId == group.Id &&
                    currentWorkspaceUserIds.Contains(member.UserId))
                .Select(member => member.User!);
        }
        else if (announcement.WorkspaceId.HasValue)
        {
            var workspaceIsReadable = await dbContext.Workspaces
                .AsNoTracking()
                .AnyAsync(workspace =>
                    workspace.Id == announcement.WorkspaceId.Value &&
                    workspace.DeletedAt == null &&
                    (workspace.Status == WorkspaceStatus.Active ||
                     workspace.Status == WorkspaceStatus.Archived),
                    cancellationToken);
            if (!workspaceIsReadable)
            {
                return [];
            }

            var currentWorkspaceUserIds = CurrentWorkspaceUserIds(announcement.WorkspaceId.Value);
            users = dbContext.Users.Where(user => currentWorkspaceUserIds.Contains(user.Id));
        }
        else
        {
            users = dbContext.Users.Where(user =>
                dbContext.TenantUsers.Any(tenantUser =>
                    tenantUser.UserId == user.Id &&
                    tenantUser.Status == TenantUserStatus.Active));
        }

        return await users
            .Where(user => user.Status == UserStatus.Active && user.DeletedAt == null)
            .Select(user => new AnnouncementTargetUser(
                user.Id,
                user.DisplayName,
                user.Email,
                dbContext.AnnouncementReads.Any(read => read.AnnouncementId == announcement.Id && read.UserId == user.Id)))
            .Distinct()
            .OrderBy(user => user.DisplayName)
            .ToListAsync(cancellationToken);
    }

    public Task<int> CountReadsAsync(Guid announcementId, CancellationToken cancellationToken = default)
    {
        return dbContext.AnnouncementReads.CountAsync(read => read.AnnouncementId == announcementId, cancellationToken);
    }

    private IQueryable<Guid> CurrentWorkspaceUserIds(Guid workspaceId) =>
        dbContext.WorkspaceMembers
            .Where(member =>
                member.WorkspaceId == workspaceId &&
                member.Status == MembershipStatus.Active &&
                dbContext.TenantUsers.Any(tenantUser =>
                    tenantUser.UserId == member.UserId &&
                    tenantUser.Status == TenantUserStatus.Active))
            .Select(member => member.UserId);
}
