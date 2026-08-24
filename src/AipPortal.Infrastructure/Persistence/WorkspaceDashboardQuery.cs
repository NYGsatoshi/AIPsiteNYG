using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Tenancy;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
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

        var now = clock.UtcNow;
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
                activeSystemAdminIds.Contains(userId),
                dbContext.TenantUsers.Any(tenantUser =>
                    tenantUser.TenantId == workspace.TenantId &&
                    tenantUser.UserId == userId &&
                    tenantUser.Status == TenantUserStatus.Active &&
                    dbContext.Users.Any(user =>
                        user.Id == userId &&
                        user.Status == UserStatus.Active &&
                        user.DeletedAt == null) &&
                    dbContext.Tenants.Any(tenant =>
                        tenant.Id == workspace.TenantId &&
                        tenant.Status == TenantStatus.Active &&
                        tenant.DeletedAt == null)),
                dbContext.Set<CapabilityGrant>().Any(grant =>
                    grant.TenantId == workspace.TenantId &&
                    grant.SubjectUserId == userId &&
                    grant.CapabilityKey == CapabilityKeys.ProjectCreate &&
                    ((grant.ScopeType == CapabilityScopeType.Workspace && grant.ScopeId == workspace.Id) ||
                     (grant.ScopeType == CapabilityScopeType.Tenant && grant.ScopeId == workspace.TenantId)) &&
                    grant.VersionNo > 0 &&
                    grant.GrantedAt <= now &&
                    grant.RevokedAt == null &&
                    (!grant.ExpiresAt.HasValue || grant.ExpiresAt > now))))
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
        // Navigation is read-only. Quick-create mutation affordances are projected
        // separately and must match the ungrouped production create boundary used
        // by this Quick Create flow rather than a broader read/group authority.
        var hasCurrentWorkspaceReadAccess =
            row.CurrentUserRole.HasValue || row.HasSystemAdminAccess;
        var hasActiveWorkspaceMembership =
            row.HasActiveTenantMembership && row.CurrentUserRole.HasValue;
        var hasWorkspaceGovernanceAuthority =
            row.CurrentUserRole is WorkspaceRole.Owner or WorkspaceRole.Admin;
        var canCreateProject =
            hasActiveWorkspaceMembership &&
            (hasWorkspaceGovernanceAuthority || row.HasDelegatedProjectCreate);
        var canAddFiles =
            row.HasSystemAdminAccess ||
            (row.HasActiveTenantMembership &&
             row.CurrentUserRole is WorkspaceRole.Owner or
                 WorkspaceRole.Admin or
                 WorkspaceRole.Adviser or
                 WorkspaceRole.Member);

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
            canCreateProject,
            canAddFiles,
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
        bool HasSystemAdminAccess,
        bool HasActiveTenantMembership,
        bool HasDelegatedProjectCreate);

    private sealed record WorkspaceCount(Guid WorkspaceId, int Count);

    private sealed record WorkspaceProjectCount(
        Guid WorkspaceId,
        ProjectStatus Status,
        int Count);
}
