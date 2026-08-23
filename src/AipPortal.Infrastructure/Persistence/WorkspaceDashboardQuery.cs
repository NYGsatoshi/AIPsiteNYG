using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class WorkspaceDashboardQuery(
    AppDbContext dbContext,
    IMessagingRepository messaging,
    IClock clock) : IWorkspaceDashboardQuery
{
    public bool IsAvailable =>
        string.Equals(
            dbContext.Database.ProviderName,
            "Npgsql.EntityFrameworkCore.PostgreSQL",
            StringComparison.Ordinal);

    public async Task<IReadOnlyList<WorkspaceDashboardListItemResponse>> ListAsync(
        Guid userId,
        CancellationToken cancellationToken = default)
    {
        if (!IsAvailable)
        {
            throw new InvalidOperationException(
                "The Workspace dashboard projection requires the PostgreSQL authorization query provider.");
        }

        var activeSystemAdminIds = dbContext.Users
            .AsNoTracking()
            .Where(user =>
                user.Id == userId &&
                user.SystemRole == SystemRole.SystemAdmin &&
                user.Status == UserStatus.Active &&
                user.DeletedAt == null)
            .Select(user => user.Id);

        var rows = await dbContext.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                workspace.DeletedAt == null &&
                workspace.Status == WorkspaceStatus.Active &&
                (activeSystemAdminIds.Contains(userId) ||
                 dbContext.WorkspaceMembers.Any(member =>
                     member.WorkspaceId == workspace.Id &&
                     member.UserId == userId &&
                     member.Status == MembershipStatus.Active)))
            .OrderBy(workspace => workspace.Name)
            .ThenBy(workspace => workspace.Id)
            .Select(workspace => new WorkspaceDashboardRow(
                workspace.Id,
                workspace.Name,
                workspace.Description,
                workspace.Icon,
                workspace.Status,
                workspace.CreatedAt,
                workspace.UpdatedAt,
                dbContext.WorkspaceMembers
                    .Where(member =>
                        member.WorkspaceId == workspace.Id &&
                        member.UserId == userId &&
                        member.Status == MembershipStatus.Active)
                    .Select(member => (WorkspaceRole?)member.Role)
                    .FirstOrDefault(),
                activeSystemAdminIds.Contains(userId)))
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            return [];
        }

        var workspaceIds = rows.Select(row => row.Id).ToArray();
        var isSystemAdmin = rows[0].HasSystemAdminAccess;

        var announcementCounts = await dbContext
            .VisibleAnnouncementsFor(userId, isSystemAdmin, clock.UtcNow)
            .Where(announcement =>
                announcement.WorkspaceId.HasValue &&
                workspaceIds.Contains(announcement.WorkspaceId.Value) &&
                !dbContext.AnnouncementReads.Any(read =>
                    read.AnnouncementId == announcement.Id &&
                    read.UserId == userId))
            .GroupBy(announcement => announcement.WorkspaceId!.Value)
            .Select(group => new WorkspaceCount(group.Key, group.Count()))
            .ToDictionaryAsync(item => item.WorkspaceId, item => item.Count, cancellationToken);

        var readableConversationIds = messaging.QueryReadableConversationIds(userId)
            ?? throw new InvalidOperationException(
                "The Workspace dashboard projection requires the canonical PostgreSQL Conversation read scope.");
        var conversationCounts = await dbContext.Conversations
            .AsNoTracking()
            .Where(conversation =>
                workspaceIds.Contains(conversation.WorkspaceId) &&
                readableConversationIds.Contains(conversation.Id) &&
                dbContext.Messages.Any(message =>
                    message.ConversationId == conversation.Id &&
                    message.AuthorUserId != userId &&
                    message.DeletedAt == null &&
                    (!dbContext.ReadStates.Any(readState =>
                         readState.ConversationId == conversation.Id &&
                         readState.UserId == userId) ||
                     dbContext.ReadStates.Any(readState =>
                         readState.ConversationId == conversation.Id &&
                         readState.UserId == userId &&
                         message.CreatedAt > readState.LastReadAt))))
            .GroupBy(conversation => conversation.WorkspaceId)
            .Select(group => new WorkspaceCount(group.Key, group.Count()))
            .ToDictionaryAsync(item => item.WorkspaceId, item => item.Count, cancellationToken);

        var projectCounts = await dbContext.VisibleProjectsFor(userId)
            .Where(project =>
                workspaceIds.Contains(project.WorkspaceId) &&
                (project.Status == ProjectStatus.Active ||
                 project.Status == ProjectStatus.Review))
            .GroupBy(project => new { project.WorkspaceId, project.Status })
            .Select(group => new WorkspaceProjectCount(
                group.Key.WorkspaceId,
                group.Key.Status,
                group.Count()))
            .ToListAsync(cancellationToken);

        var runningProjectCounts = projectCounts
            .Where(item => item.Status == ProjectStatus.Active)
            .ToDictionary(item => item.WorkspaceId, item => item.Count);
        var needsReviewProjectCounts = projectCounts
            .Where(item => item.Status == ProjectStatus.Review)
            .ToDictionary(item => item.WorkspaceId, item => item.Count);

        return rows
            .Select(row => ToResponse(
                row,
                announcementCounts.GetValueOrDefault(row.Id),
                conversationCounts.GetValueOrDefault(row.Id),
                runningProjectCounts.GetValueOrDefault(row.Id),
                needsReviewProjectCounts.GetValueOrDefault(row.Id)))
            .ToList();
    }

    private static WorkspaceDashboardListItemResponse ToResponse(
        WorkspaceDashboardRow row,
        int unreadAnnouncementCount,
        int unreadConversationCount,
        int runningProjectCount,
        int needsReviewProjectCount)
    {
        // The current member-list destination uses the same CanViewWorkspace
        // boundary as the card. The current Project surface is also valid for
        // every authorized active Workspace and independently filters its
        // returned Projects through VisibleProjectsFor. These navigation flags
        // grant no mutation or child-resource read authority.
        var hasCurrentWorkspaceReadAccess =
            row.CurrentUserRole.HasValue || row.HasSystemAdminAccess;
        return new WorkspaceDashboardListItemResponse(
            row.Id,
            row.Name,
            row.Description,
            row.Icon,
            row.Status,
            row.CreatedAt,
            row.UpdatedAt ?? row.CreatedAt,
            row.CurrentUserRole,
            row.CurrentUserRole.HasValue
                ? WorkspaceDashboardAccessSource.WorkspaceMembership
                : WorkspaceDashboardAccessSource.SystemAdmin,
            hasCurrentWorkspaceReadAccess,
            hasCurrentWorkspaceReadAccess,
            hasCurrentWorkspaceReadAccess,
            unreadAnnouncementCount,
            unreadConversationCount,
            runningProjectCount + needsReviewProjectCount,
            runningProjectCount,
            needsReviewProjectCount);
    }

    private sealed record WorkspaceDashboardRow(
        Guid Id,
        string Name,
        string? Description,
        string? Icon,
        WorkspaceStatus Status,
        DateTimeOffset CreatedAt,
        DateTimeOffset? UpdatedAt,
        WorkspaceRole? CurrentUserRole,
        bool HasSystemAdminAccess);

    private sealed record WorkspaceCount(Guid WorkspaceId, int Count);

    private sealed record WorkspaceProjectCount(
        Guid WorkspaceId,
        ProjectStatus Status,
        int Count);
}
