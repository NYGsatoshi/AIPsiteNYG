using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Search;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class DbSearchService(AppDbContext dbContext, ICurrentUser currentUser) : ISearchService
{
    private const int MaxPageSize = 50;

    public async Task<Result<SearchResponse>> SearchAsync(SearchRequest request, CancellationToken cancellationToken = default)
    {
        if (!currentUser.IsAuthenticated || !currentUser.UserId.HasValue)
        {
            return Result<SearchResponse>.Failure("Authentication is required.");
        }

        var hasFilters = request.WorkspaceId.HasValue ||
            request.GroupId.HasValue ||
            request.ProjectId.HasValue ||
            request.AuthorUserId.HasValue ||
            request.FromDate.HasValue ||
            request.ToDate.HasValue;
        if (string.IsNullOrWhiteSpace(request.Q) && !hasFilters)
        {
            return Result<SearchResponse>.Failure("Search query or filters are required.");
        }

        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);
        var userId = currentUser.UserId.Value;
        var isSystemAdmin = currentUser.SystemRole == SystemRole.SystemAdmin;
        var q = request.Q?.Trim();

        var items = new List<SearchResultItemResponse>();

        if (ShouldInclude(request.Type, SearchResultType.User))
        {
            items.AddRange(await SearchUsersAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Workspace))
        {
            items.AddRange(await SearchWorkspacesAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Group))
        {
            items.AddRange(await SearchGroupsAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Channel))
        {
            items.AddRange(await SearchChannelsAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Post))
        {
            items.AddRange(await SearchPostsAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Message))
        {
            items.AddRange(await SearchMessagesAsync(userId, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Announcement))
        {
            items.AddRange(await SearchAnnouncementsAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Project))
        {
            items.AddRange(await SearchProjectsAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Task))
        {
            items.AddRange(await SearchTasksAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Artifact))
        {
            items.AddRange(await SearchArtifactsAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.ActivityLog))
        {
            items.AddRange(await SearchActivityLogsAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        if (ShouldInclude(request.Type, SearchResultType.Comment))
        {
            items.AddRange(await SearchCommentsAsync(userId, isSystemAdmin, q, request, cancellationToken));
        }

        var ordered = items
            .OrderByDescending(item => item.CreatedAt)
            .ThenBy(item => item.Type)
            .ToList();
        var pageItems = ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();

        return Result<SearchResponse>.Success(new SearchResponse(q, page, pageSize, ordered.Count, pageItems));
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchUsersAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var query = dbContext.Users.AsNoTracking().Where(user => user.DeletedAt == null);
        if (!isSystemAdmin)
        {
            query = query.Where(user => dbContext.WorkspaceMembers.Any(member =>
                member.UserId == user.Id &&
                member.Status == MembershipStatus.Active &&
                dbContext.WorkspaceMembers.Any(current => current.WorkspaceId == member.WorkspaceId && current.UserId == userId && current.Status == MembershipStatus.Active)));
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(user => EF.Functions.ILike(user.DisplayName, $"%{q}%") || EF.Functions.ILike(user.Email, $"%{q}%"));
        }

        query = ApplyDateFilters(query, request, user => user.CreatedAt);
        return await query
            .Select(user => new SearchResultItemResponse(SearchResultType.User, user.Id, user.DisplayName, user.Email, $"/users/{user.Id}", null, null, null, user.CreatedAt, user.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchWorkspacesAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var query = dbContext.Workspaces.AsNoTracking().Where(workspace => workspace.DeletedAt == null);
        if (!isSystemAdmin)
        {
            query = query.Where(workspace => workspace.Members.Any(member => member.UserId == userId && member.Status == MembershipStatus.Active));
        }

        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(workspace => workspace.Id == request.WorkspaceId.Value);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(workspace => EF.Functions.ILike(workspace.Name, $"%{q}%") || (workspace.Description != null && EF.Functions.ILike(workspace.Description, $"%{q}%")));
        }

        query = ApplyDateFilters(query, request, workspace => workspace.CreatedAt);
        return await query
            .Select(workspace => new SearchResultItemResponse(SearchResultType.Workspace, workspace.Id, workspace.Name, workspace.Description, $"/workspaces/{workspace.Id}", workspace.Id, null, null, workspace.CreatedAt, null))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchGroupsAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var query = dbContext.Groups.AsNoTracking().Where(group => group.DeletedAt == null);
        if (!isSystemAdmin)
        {
            query = query.Where(group => dbContext.WorkspaceMembers.Any(member => member.WorkspaceId == group.WorkspaceId && member.UserId == userId && member.Status == MembershipStatus.Active));
        }

        query = ApplyScopeFilters(query, request, group => group.WorkspaceId, group => group.Id, null);
        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(group => EF.Functions.ILike(group.Name, $"%{q}%") || (group.Description != null && EF.Functions.ILike(group.Description, $"%{q}%")));
        }

        query = ApplyDateFilters(query, request, group => group.CreatedAt);
        return await query
            .Select(group => new SearchResultItemResponse(SearchResultType.Group, group.Id, group.Name, group.Description, $"/groups/{group.Id}", group.WorkspaceId, group.Id, null, group.CreatedAt, null))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchChannelsAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var query = VisibleChannels(userId, isSystemAdmin);
        query = ApplyScopeFilters(query, request, channel => channel.WorkspaceId, channel => channel.GroupId, null);
        if (request.GroupId.HasValue)
        {
            query = query.Where(channel => channel.GroupId == request.GroupId.Value);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(channel => EF.Functions.ILike(channel.Name, $"%{q}%") || (channel.Description != null && EF.Functions.ILike(channel.Description, $"%{q}%")));
        }

        query = ApplyDateFilters(query, request, channel => channel.CreatedAt);
        return await query
            .Select(channel => new SearchResultItemResponse(SearchResultType.Channel, channel.Id, channel.Name, channel.Description, $"/channels/{channel.Id}", channel.WorkspaceId, channel.GroupId, null, channel.CreatedAt, null))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchPostsAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var visibleChannelIds = VisibleChannels(userId, isSystemAdmin).Select(channel => channel.Id);
        var query = dbContext.Posts.AsNoTracking()
            .Where(post => post.DeletedAt == null && visibleChannelIds.Contains(post.ChannelId))
            .Join(dbContext.Channels, post => post.ChannelId, channel => channel.Id, (post, channel) => new { post, channel });

        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(item => item.channel.WorkspaceId == request.WorkspaceId);
        }

        if (request.GroupId.HasValue)
        {
            query = query.Where(item => item.channel.GroupId == request.GroupId);
        }

        if (request.AuthorUserId.HasValue)
        {
            query = query.Where(item => item.post.AuthorUserId == request.AuthorUserId);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(item => EF.Functions.ILike(item.post.Body, $"%{q}%"));
        }

        query = query.Where(item =>
            (!request.FromDate.HasValue || item.post.CreatedAt >= request.FromDate.Value) &&
            (!request.ToDate.HasValue || item.post.CreatedAt <= request.ToDate.Value));

        return await query
            .Select(item => new SearchResultItemResponse(SearchResultType.Post, item.post.Id, "Post", Snippet(item.post.Body), $"/posts/{item.post.Id}", item.channel.WorkspaceId, item.channel.GroupId, null, item.post.CreatedAt, item.post.AuthorUser!.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchMessagesAsync(Guid userId, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var memberConversationIds = dbContext.ConversationMembers
            .Where(member =>
                member.UserId == userId &&
                member.LeftAt == null &&
                member.RemovedAt == null &&
                member.CanRead)
            .Select(member => member.ConversationId);
        var visibleProjectIds = VisibleProjects(userId, false).Select(project => project.Id);

        var query = dbContext.Messages.AsNoTracking()
            .Where(message => message.DeletedAt == null && memberConversationIds.Contains(message.ConversationId))
            .Join(dbContext.Conversations, message => message.ConversationId, conversation => conversation.Id, (message, conversation) => new { message, conversation })
            .Where(item =>
                (item.conversation.Type != ConversationType.ProjectChannel || item.conversation.ProjectId.HasValue) &&
                (item.conversation.Type != ConversationType.Thread ||
                 item.conversation.ParentConversationId.HasValue &&
                 dbContext.ConversationMembers.Any(parentMember =>
                     parentMember.ConversationId == item.conversation.ParentConversationId.Value &&
                     parentMember.UserId == userId &&
                     parentMember.LeftAt == null &&
                     parentMember.RemovedAt == null &&
                     parentMember.CanRead)) &&
                (!item.conversation.ProjectId.HasValue ||
                 visibleProjectIds.Contains(item.conversation.ProjectId.Value)));

        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(item => item.conversation.WorkspaceId == request.WorkspaceId);
        }

        if (request.AuthorUserId.HasValue)
        {
            query = query.Where(item => item.message.AuthorUserId == request.AuthorUserId);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(item =>
                EF.Functions.ILike(item.message.Body, $"%{q}%") ||
                (item.conversation.Title != null && EF.Functions.ILike(item.conversation.Title, $"%{q}%")));
        }

        query = query.Where(item =>
            (!request.FromDate.HasValue || item.message.CreatedAt >= request.FromDate.Value) &&
            (!request.ToDate.HasValue || item.message.CreatedAt <= request.ToDate.Value));

        return await query
            .Select(item => new SearchResultItemResponse(SearchResultType.Message, item.message.Id, item.conversation.Title ?? "Conversation", Snippet(item.message.Body), $"/conversations/{item.conversation.Id}", item.conversation.WorkspaceId, null, null, item.message.CreatedAt, item.message.AuthorUser!.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchAnnouncementsAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var query = dbContext.Announcements.AsNoTracking().Where(announcement =>
            announcement.DeletedAt == null &&
            announcement.PublishedAt <= now &&
            (!announcement.ExpiresAt.HasValue || announcement.ExpiresAt.Value > now));
        if (!isSystemAdmin)
        {
            query = query.Where(announcement =>
                announcement.WorkspaceId == null ||
                (announcement.WorkspaceId.HasValue && dbContext.WorkspaceMembers.Any(member => member.WorkspaceId == announcement.WorkspaceId && member.UserId == userId && member.Status == MembershipStatus.Active)) ||
                (announcement.GroupId.HasValue && dbContext.GroupMembers.Any(member => member.GroupId == announcement.GroupId && member.UserId == userId)) ||
                (announcement.ChannelId.HasValue && dbContext.ChannelMembers.Any(member => member.ChannelId == announcement.ChannelId && member.UserId == userId)));
        }

        query = ApplyScopeFilters(query, request, announcement => announcement.WorkspaceId, announcement => announcement.GroupId, null);
        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(announcement => EF.Functions.ILike(announcement.Title, $"%{q}%") || EF.Functions.ILike(announcement.Body, $"%{q}%"));
        }

        query = ApplyDateFilters(query, request, announcement => announcement.PublishedAt);
        return await query
            .Select(announcement => new SearchResultItemResponse(SearchResultType.Announcement, announcement.Id, announcement.Title, Snippet(announcement.Body), $"/announcements/{announcement.Id}", announcement.WorkspaceId, announcement.GroupId, null, announcement.PublishedAt, announcement.AuthorUser!.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchProjectsAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var query = VisibleProjects(userId, isSystemAdmin);
        query = ApplyScopeFilters(query, request, project => project.WorkspaceId, project => project.GroupId, project => project.Id);
        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(project => EF.Functions.ILike(project.Name, $"%{q}%") || (project.Description != null && EF.Functions.ILike(project.Description, $"%{q}%")));
        }

        query = ApplyDateFilters(query, request, project => project.CreatedAt);
        return await query
            .Select(project => new SearchResultItemResponse(SearchResultType.Project, project.Id, project.Name, project.Description, $"/projects/{project.Id}", project.WorkspaceId, project.GroupId, project.Id, project.CreatedAt, project.CreatedByUser!.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchTasksAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var visibleProjectIds = VisibleProjects(userId, isSystemAdmin).Select(project => project.Id);
        var query = dbContext.TaskItems.AsNoTracking()
            .Where(task => task.DeletedAt == null && visibleProjectIds.Contains(task.ProjectId))
            .Join(dbContext.Projects, task => task.ProjectId, project => project.Id, (task, project) => new { task, project });

        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(item => item.project.WorkspaceId == request.WorkspaceId);
        }

        if (request.GroupId.HasValue)
        {
            query = query.Where(item => item.project.GroupId == request.GroupId);
        }

        if (request.ProjectId.HasValue)
        {
            query = query.Where(item => item.project.Id == request.ProjectId);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(item => EF.Functions.ILike(item.task.Title, $"%{q}%") || (item.task.Description != null && EF.Functions.ILike(item.task.Description, $"%{q}%")));
        }

        query = query.Where(item =>
            (!request.FromDate.HasValue || item.task.CreatedAt >= request.FromDate.Value) &&
            (!request.ToDate.HasValue || item.task.CreatedAt <= request.ToDate.Value));

        return await query
            .Select(item => new SearchResultItemResponse(SearchResultType.Task, item.task.Id, item.task.Title, item.task.Description, $"/tasks/{item.task.Id}", item.project.WorkspaceId, item.project.GroupId, item.project.Id, item.task.CreatedAt, item.task.CreatedByUser!.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchArtifactsAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var visibleProjectIds = VisibleProjects(userId, isSystemAdmin).Select(project => project.Id);
        var query = dbContext.Artifacts.AsNoTracking()
            .Where(artifact => artifact.DeletedAt == null && visibleProjectIds.Contains(artifact.ProjectId))
            .Join(dbContext.Projects, artifact => artifact.ProjectId, project => project.Id, (artifact, project) => new { artifact, project });

        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(item => item.project.WorkspaceId == request.WorkspaceId);
        }

        if (request.GroupId.HasValue)
        {
            query = query.Where(item => item.project.GroupId == request.GroupId);
        }

        if (request.ProjectId.HasValue)
        {
            query = query.Where(item => item.project.Id == request.ProjectId);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(item => EF.Functions.ILike(item.artifact.Name, $"%{q}%") || (item.artifact.Description != null && EF.Functions.ILike(item.artifact.Description, $"%{q}%")));
        }

        query = query.Where(item =>
            (!request.FromDate.HasValue || item.artifact.CreatedAt >= request.FromDate.Value) &&
            (!request.ToDate.HasValue || item.artifact.CreatedAt <= request.ToDate.Value));

        return await query
            .Select(item => new SearchResultItemResponse(SearchResultType.Artifact, item.artifact.Id, item.artifact.Name, item.artifact.Description, $"/artifacts/{item.artifact.Id}", item.project.WorkspaceId, item.project.GroupId, item.project.Id, item.artifact.CreatedAt, item.artifact.CreatedByUser!.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchActivityLogsAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var visibleProjectIds = VisibleProjects(userId, isSystemAdmin).Select(project => project.Id);
        var query = dbContext.ActivityLogs.AsNoTracking()
            .Where(log => visibleProjectIds.Contains(log.ProjectId))
            .Join(dbContext.Projects, log => log.ProjectId, project => project.Id, (log, project) => new { log, project });

        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(item => item.project.WorkspaceId == request.WorkspaceId);
        }

        if (request.GroupId.HasValue)
        {
            query = query.Where(item => item.project.GroupId == request.GroupId);
        }

        if (request.ProjectId.HasValue)
        {
            query = query.Where(item => item.project.Id == request.ProjectId);
        }

        if (request.AuthorUserId.HasValue)
        {
            query = query.Where(item => item.log.AuthorUserId == request.AuthorUserId);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(item => EF.Functions.ILike(item.log.Body, $"%{q}%"));
        }

        query = query.Where(item =>
            (!request.FromDate.HasValue || item.log.CreatedAt >= request.FromDate.Value) &&
            (!request.ToDate.HasValue || item.log.CreatedAt <= request.ToDate.Value));

        return await query
            .Select(item => new SearchResultItemResponse(SearchResultType.ActivityLog, item.log.Id, item.log.ActivityType.ToString(), Snippet(item.log.Body), $"/projects/{item.project.Id}/activity/{item.log.Id}", item.project.WorkspaceId, item.project.GroupId, item.project.Id, item.log.CreatedAt, item.log.AuthorUser!.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<SearchResultItemResponse>> SearchCommentsAsync(Guid userId, bool isSystemAdmin, string? q, SearchRequest request, CancellationToken cancellationToken)
    {
        var visibleProjectIds = VisibleProjects(userId, isSystemAdmin).Select(project => project.Id);
        var query = dbContext.Comments.AsNoTracking()
            .Where(comment => comment.DeletedAt == null &&
                ((comment.TargetType == CommentTargetType.Project && visibleProjectIds.Contains(comment.TargetId)) ||
                 (comment.TargetType == CommentTargetType.TaskItem && dbContext.TaskItems.Any(item =>
                     item.Id == comment.TargetId && visibleProjectIds.Contains(item.ProjectId))) ||
                 (comment.TargetType == CommentTargetType.Milestone && dbContext.Milestones.Any(item =>
                     item.Id == comment.TargetId && visibleProjectIds.Contains(item.ProjectId))) ||
                 (comment.TargetType == CommentTargetType.Artifact && dbContext.Artifacts.Any(item =>
                     item.Id == comment.TargetId && visibleProjectIds.Contains(item.ProjectId))) ||
                 (comment.TargetType == CommentTargetType.ArtifactVersion && dbContext.ArtifactVersions.Any(item =>
                     item.Id == comment.TargetId && item.Artifact != null && visibleProjectIds.Contains(item.Artifact.ProjectId))) ||
                 (comment.TargetType == CommentTargetType.ActivityLog && dbContext.ActivityLogs.Any(item =>
                     item.Id == comment.TargetId && visibleProjectIds.Contains(item.ProjectId)))));

        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(comment => comment.WorkspaceId == request.WorkspaceId.Value);
        }

        if (request.AuthorUserId.HasValue)
        {
            query = query.Where(comment => comment.AuthorUserId == request.AuthorUserId);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(comment => EF.Functions.ILike(comment.Body, $"%{q}%"));
        }

        query = ApplyDateFilters(query, request, comment => comment.CreatedAt);
        return await query
            .Select(comment => new SearchResultItemResponse(SearchResultType.Comment, comment.Id, comment.TargetType.ToString(), Snippet(comment.Body), $"/comments/{comment.Id}", comment.WorkspaceId, null, null, comment.CreatedAt, comment.AuthorUser!.DisplayName))
            .Take(100)
            .ToListAsync(cancellationToken);
    }

    private IQueryable<Domain.Entities.Channel> VisibleChannels(Guid userId, bool isSystemAdmin)
    {
        var query = dbContext.Channels.AsNoTracking().Where(channel => channel.DeletedAt == null && channel.Status == ChannelStatus.Active);
        if (isSystemAdmin)
        {
            return query;
        }

        return query.Where(channel =>
            ((channel.Type == ChannelType.Public || channel.Type == ChannelType.Announcement) &&
                dbContext.GroupMembers.Any(member => member.GroupId == channel.GroupId && member.UserId == userId)) ||
            dbContext.ChannelMembers.Any(member => member.ChannelId == channel.Id && member.UserId == userId));
    }

    private IQueryable<Domain.Entities.Project> VisibleProjects(Guid userId, bool isSystemAdmin)
    {
        return dbContext.Projects.AsNoTracking().Where(project =>
            project.DeletedAt == null &&
            project.Status != ProjectStatus.Archived &&
            project.Status != ProjectStatus.Deleted &&
            dbContext.WorkspaceMembers.Any(member =>
                member.WorkspaceId == project.WorkspaceId &&
                member.UserId == userId &&
                member.Status == MembershipStatus.Active) &&
            ((project.Status != ProjectStatus.Planning &&
              project.Status != ProjectStatus.Suspended) ||
             project.Members.Any(member => member.UserId == userId)));
    }

    private static bool ShouldInclude(SearchResultType requested, SearchResultType item)
    {
        return requested == SearchResultType.All || requested == item;
    }

    private static string? Snippet(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Length <= 180 ? value : value[..180];
    }

    private static IQueryable<T> ApplyDateFilters<T>(IQueryable<T> query, SearchRequest request, System.Linq.Expressions.Expression<Func<T, DateTimeOffset>> createdAt)
    {
        if (request.FromDate.HasValue)
        {
            query = query.Where(ExpressionGreaterThanOrEqual(createdAt, request.FromDate.Value));
        }

        if (request.ToDate.HasValue)
        {
            query = query.Where(ExpressionLessThanOrEqual(createdAt, request.ToDate.Value));
        }

        return query;
    }

    private static IQueryable<T> ApplyScopeFilters<T>(
        IQueryable<T> query,
        SearchRequest request,
        System.Linq.Expressions.Expression<Func<T, Guid?>> workspaceId,
        System.Linq.Expressions.Expression<Func<T, Guid?>> groupId,
        System.Linq.Expressions.Expression<Func<T, Guid?>>? projectId)
    {
        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(ExpressionEqual(workspaceId, request.WorkspaceId.Value));
        }

        if (request.GroupId.HasValue)
        {
            query = query.Where(ExpressionEqual(groupId, request.GroupId.Value));
        }

        if (request.ProjectId.HasValue && projectId is not null)
        {
            query = query.Where(ExpressionEqual(projectId, request.ProjectId.Value));
        }

        return query;
    }

    private static IQueryable<T> ApplyScopeFilters<T>(
        IQueryable<T> query,
        SearchRequest request,
        System.Linq.Expressions.Expression<Func<T, Guid>> workspaceId,
        System.Linq.Expressions.Expression<Func<T, Guid?>> groupId,
        System.Linq.Expressions.Expression<Func<T, Guid>>? projectId)
    {
        if (request.WorkspaceId.HasValue)
        {
            query = query.Where(ExpressionEqual(workspaceId, request.WorkspaceId.Value));
        }

        if (request.GroupId.HasValue)
        {
            query = query.Where(ExpressionEqual(groupId, request.GroupId.Value));
        }

        if (request.ProjectId.HasValue && projectId is not null)
        {
            query = query.Where(ExpressionEqual(projectId, request.ProjectId.Value));
        }

        return query;
    }

    private static System.Linq.Expressions.Expression<Func<T, bool>> ExpressionEqual<T, TProperty>(System.Linq.Expressions.Expression<Func<T, TProperty>> property, Guid value)
    {
        var converted = System.Linq.Expressions.Expression.Convert(property.Body, typeof(Guid?));
        var constant = System.Linq.Expressions.Expression.Constant((Guid?)value, typeof(Guid?));
        return System.Linq.Expressions.Expression.Lambda<Func<T, bool>>(System.Linq.Expressions.Expression.Equal(converted, constant), property.Parameters);
    }

    private static System.Linq.Expressions.Expression<Func<T, bool>> ExpressionGreaterThanOrEqual<T>(System.Linq.Expressions.Expression<Func<T, DateTimeOffset>> property, DateTimeOffset value)
    {
        return System.Linq.Expressions.Expression.Lambda<Func<T, bool>>(
            System.Linq.Expressions.Expression.GreaterThanOrEqual(property.Body, System.Linq.Expressions.Expression.Constant(value)),
            property.Parameters);
    }

    private static System.Linq.Expressions.Expression<Func<T, bool>> ExpressionLessThanOrEqual<T>(System.Linq.Expressions.Expression<Func<T, DateTimeOffset>> property, DateTimeOffset value)
    {
        return System.Linq.Expressions.Expression.Lambda<Func<T, bool>>(
            System.Linq.Expressions.Expression.LessThanOrEqual(property.Body, System.Linq.Expressions.Expression.Constant(value)),
            property.Parameters);
    }
}
