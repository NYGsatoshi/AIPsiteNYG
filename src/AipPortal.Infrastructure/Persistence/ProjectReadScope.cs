using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// SQL-translatable form of the current Project read boundary implemented by
/// ProjectAuthorizationService.CanViewProject. Keep that imperative boundary
/// and this query scope equivalent until canonical Visibility is persisted.
/// </summary>
internal static class ProjectReadScope
{
    public static IQueryable<Project> VisibleProjectsFor(this AppDbContext dbContext, Guid userId)
    {
        var activeSystemAdminIds = dbContext.Users
            .AsNoTracking()
            .Where(user =>
                user.Id == userId &&
                user.SystemRole == SystemRole.SystemAdmin &&
                user.Status == UserStatus.Active)
            .Select(user => user.Id);

        return dbContext.Projects
            .AsNoTracking()
            .Where(project =>
                project.DeletedAt == null &&
                project.Status != ProjectStatus.Archived &&
                project.Status != ProjectStatus.Deleted &&
                (activeSystemAdminIds.Contains(userId) ||
                 dbContext.WorkspaceMembers.Any(member =>
                     member.WorkspaceId == project.WorkspaceId &&
                     member.UserId == userId &&
                     member.Status == MembershipStatus.Active)) &&
                (project.Members.Any(member => member.UserId == userId) ||
                 ((project.Status == ProjectStatus.Active ||
                   project.Status == ProjectStatus.Review ||
                   project.Status == ProjectStatus.Completed) &&
                  (!project.GroupId.HasValue ||
                   activeSystemAdminIds.Contains(userId) ||
                   dbContext.WorkspaceMembers.Any(member =>
                       member.WorkspaceId == project.WorkspaceId &&
                       member.UserId == userId &&
                       member.Status == MembershipStatus.Active &&
                       (member.Role == WorkspaceRole.Owner || member.Role == WorkspaceRole.Admin)) ||
                   dbContext.GroupMembers.Any(member =>
                       member.GroupId == project.GroupId.Value &&
                       member.UserId == userId)))));
    }
}
