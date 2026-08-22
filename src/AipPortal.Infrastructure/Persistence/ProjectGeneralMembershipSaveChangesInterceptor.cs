using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Keeps ProjectGeneral participant rights aligned with explicit Project
/// membership in the same database save. It does not materialize broad
/// WorkspaceVisible viewers. Legacy/Draft Projects without ProjectGeneral are
/// intentionally left untouched.
/// </summary>
public sealed class ProjectGeneralMembershipSaveChangesInterceptor(IClock clock) : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        if (eventData.Context is AppDbContext dbContext)
        {
            Apply(dbContext);
        }
        return base.SavingChanges(eventData, result);
    }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is AppDbContext dbContext)
        {
            await ApplyAsync(dbContext, cancellationToken);
        }
        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private void Apply(AppDbContext dbContext)
    {
        foreach (var entry in RelevantEntries(dbContext))
        {
            ApplyEntry(
                dbContext,
                entry,
                projectId => FindProject(dbContext, projectId),
                project => FindProjectGeneral(dbContext, project),
                (conversationId, userId) => FindParticipant(dbContext, conversationId, userId));
        }
    }

    private async Task ApplyAsync(AppDbContext dbContext, CancellationToken cancellationToken)
    {
        foreach (var entry in RelevantEntries(dbContext))
        {
            var member = entry.Entity;
            var project = FindTrackedProject(dbContext, member.ProjectId) ??
                          await dbContext.Projects.FirstOrDefaultAsync(
                              item => item.Id == member.ProjectId,
                              cancellationToken);
            if (project is null)
            {
                continue;
            }

            RejectArchivedMutation(project);
            var conversation = FindTrackedProjectGeneral(dbContext, project) ??
                               await dbContext.Conversations.FirstOrDefaultAsync(
                                   item => item.TenantId == project.TenantId &&
                                           item.WorkspaceId == project.WorkspaceId &&
                                           item.ProjectId == project.Id &&
                                           item.DefaultKind == ConversationDefaultKind.ProjectGeneral,
                                   cancellationToken);
            if (conversation is null)
            {
                continue;
            }

            ValidateCanonicalConversation(conversation, project);
            var participant = FindTrackedParticipant(dbContext, conversation.Id, member.UserId) ??
                              await dbContext.ConversationMembers.FirstOrDefaultAsync(
                                  item => item.ConversationId == conversation.Id &&
                                          item.UserId == member.UserId,
                                  cancellationToken);
            Synchronize(dbContext, entry, project, conversation, participant);
        }
    }

    private void ApplyEntry(
        AppDbContext dbContext,
        Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry<ProjectMember> entry,
        Func<Guid, Project?> projectResolver,
        Func<Project, Conversation?> conversationResolver,
        Func<Guid, Guid, ConversationMember?> participantResolver)
    {
        var member = entry.Entity;
        var project = projectResolver(member.ProjectId);
        if (project is null)
        {
            return;
        }

        RejectArchivedMutation(project);
        var conversation = conversationResolver(project);
        if (conversation is null)
        {
            return;
        }

        ValidateCanonicalConversation(conversation, project);
        var participant = participantResolver(conversation.Id, member.UserId);
        Synchronize(dbContext, entry, project, conversation, participant);
    }

    private static IReadOnlyList<Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry<ProjectMember>> RelevantEntries(
        AppDbContext dbContext) =>
        dbContext.ChangeTracker.Entries<ProjectMember>()
            .Where(entry =>
                entry.State is EntityState.Added or EntityState.Deleted ||
                (entry.State == EntityState.Modified && entry.Property(item => item.Role).IsModified))
            .ToArray();

    private static void RejectArchivedMutation(Project project)
    {
        if (project.DeletedAt.HasValue || project.Status is ProjectStatus.Archived or ProjectStatus.Deleted)
        {
            throw new ProjectMembershipReadOnlyException();
        }
    }

    private void Synchronize(
        AppDbContext dbContext,
        Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry<ProjectMember> entry,
        Project project,
        Conversation conversation,
        ConversationMember? participant)
    {
        if (entry.State == EntityState.Deleted)
        {
            if (participant is null)
            {
                return;
            }

            var originalRole = entry.Property(item => item.Role).OriginalValue;
            var projectDerivedAdmin = originalRole == ProjectRole.Owner ||
                                      entry.Entity.UserId == project.OwnerUserId ||
                                      entry.Entity.UserId == project.CreatedByUserId;
            if (participant.Role == ConversationMemberRole.Admin && !projectDerivedAdmin)
            {
                // Preserve separately granted Messaging administration. Project
                // role changes/removal must not silently revoke independent authority.
                return;
            }

            participant.CanRead = false;
            participant.CanPost = false;
            participant.CanManageMembers = false;
            participant.CanCreateThread = false;
            participant.RemovedAt ??= clock.UtcNow;
            return;
        }

        var desiredRole = DesiredRole(project, entry.Entity);
        if (participant is null)
        {
            participant = NewParticipant(project, conversation.Id, entry.Entity.UserId, desiredRole);
            dbContext.ConversationMembers.Add(participant);
            return;
        }

        RestoreParticipant(participant, desiredRole);
    }

    private ConversationMember NewParticipant(
        Project project,
        Guid conversationId,
        Guid userId,
        ConversationMemberRole role)
    {
        var readOnly = role == ConversationMemberRole.ReadOnly;
        var admin = role == ConversationMemberRole.Admin;
        return new ConversationMember
        {
            TenantId = project.TenantId,
            ConversationId = conversationId,
            UserId = userId,
            Role = role,
            CanRead = true,
            CanPost = !readOnly,
            CanManageMembers = admin,
            CanCreateThread = !readOnly,
            JoinedAt = clock.UtcNow
        };
    }

    private static void RestoreParticipant(
        ConversationMember participant,
        ConversationMemberRole desiredRole)
    {
        participant.LeftAt = null;
        participant.RemovedAt = null;
        participant.RemovedByUserId = null;
        participant.CanRead = true;

        if (participant.Role == ConversationMemberRole.Admin || desiredRole == ConversationMemberRole.Admin)
        {
            participant.Role = ConversationMemberRole.Admin;
            participant.CanPost = true;
            participant.CanManageMembers = true;
            participant.CanCreateThread = true;
            return;
        }

        var readOnly = desiredRole == ConversationMemberRole.ReadOnly;
        participant.Role = desiredRole;
        participant.CanPost = !readOnly;
        participant.CanManageMembers = false;
        participant.CanCreateThread = !readOnly;
    }

    private static ConversationMemberRole DesiredRole(Project project, ProjectMember member) =>
        member.Role == ProjectRole.Owner ||
        member.UserId == project.OwnerUserId ||
        member.UserId == project.CreatedByUserId
            ? ConversationMemberRole.Admin
            : member.Role == ProjectRole.Viewer
                ? ConversationMemberRole.ReadOnly
                : ConversationMemberRole.Member;

    private static Project? FindProject(AppDbContext dbContext, Guid projectId) =>
        FindTrackedProject(dbContext, projectId) ??
        dbContext.Projects.FirstOrDefault(item => item.Id == projectId);

    private static Project? FindTrackedProject(AppDbContext dbContext, Guid projectId) =>
        dbContext.ChangeTracker.Entries<Project>()
            .Select(entry => entry.Entity)
            .FirstOrDefault(project => project.Id == projectId);

    private static Conversation? FindProjectGeneral(AppDbContext dbContext, Project project) =>
        FindTrackedProjectGeneral(dbContext, project) ??
        dbContext.Conversations.FirstOrDefault(item =>
            item.TenantId == project.TenantId &&
            item.WorkspaceId == project.WorkspaceId &&
            item.ProjectId == project.Id &&
            item.DefaultKind == ConversationDefaultKind.ProjectGeneral);

    private static Conversation? FindTrackedProjectGeneral(AppDbContext dbContext, Project project) =>
        dbContext.ChangeTracker.Entries<Conversation>()
            .Select(entry => entry.Entity)
            .FirstOrDefault(item =>
                item.TenantId == project.TenantId &&
                item.WorkspaceId == project.WorkspaceId &&
                item.ProjectId == project.Id &&
                item.DefaultKind == ConversationDefaultKind.ProjectGeneral);

    private static ConversationMember? FindParticipant(
        AppDbContext dbContext,
        Guid conversationId,
        Guid userId) =>
        FindTrackedParticipant(dbContext, conversationId, userId) ??
        dbContext.ConversationMembers.FirstOrDefault(item =>
            item.ConversationId == conversationId && item.UserId == userId);

    private static ConversationMember? FindTrackedParticipant(
        AppDbContext dbContext,
        Guid conversationId,
        Guid userId) =>
        dbContext.ChangeTracker.Entries<ConversationMember>()
            .Where(entry => entry.State != EntityState.Deleted)
            .Select(entry => entry.Entity)
            .FirstOrDefault(item =>
                item.ConversationId == conversationId && item.UserId == userId);

    private static void ValidateCanonicalConversation(Conversation conversation, Project project)
    {
        if (conversation.TenantId != project.TenantId ||
            conversation.WorkspaceId != project.WorkspaceId ||
            conversation.ProjectId != project.Id ||
            conversation.Type != ConversationType.ProjectChannel ||
            conversation.Title != "general" ||
            conversation.Visibility != ConversationVisibility.PublicWithinScope ||
            conversation.DefaultKind != ConversationDefaultKind.ProjectGeneral)
        {
            throw new InvalidOperationException("Existing ProjectGeneral identity is inconsistent.");
        }
    }
}

public sealed class ProjectMembershipReadOnlyException()
    : DbUpdateConcurrencyException("Archived or deleted Projects are read-only for membership mutations.")
{
}
