using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class FileRepository(AppDbContext dbContext) : IFileRepository
{
    public Task<Attachment?> GetAttachmentAsync(Guid attachmentId, CancellationToken cancellationToken = default)
    {
        return dbContext.Attachments.FirstOrDefaultAsync(attachment => attachment.Id == attachmentId, cancellationToken);
    }

    public async Task AddAttachmentAsync(Attachment attachment, CancellationToken cancellationToken = default)
    {
        await dbContext.Attachments.AddAsync(attachment, cancellationToken);
    }

    public async Task<FileOwnerContext?> ResolveOwnerAsync(AttachmentOwnerType ownerType, Guid ownerId, CancellationToken cancellationToken = default)
    {
        return ownerType switch
        {
            AttachmentOwnerType.Message => await ResolveMessageAsync(ownerId, cancellationToken),
            AttachmentOwnerType.Post => await ResolvePostAsync(ownerId, cancellationToken),
            AttachmentOwnerType.TaskItem => await ResolveTaskAsync(ownerId, cancellationToken),
            AttachmentOwnerType.ArtifactVersion => await ResolveArtifactVersionAsync(ownerId, cancellationToken),
            AttachmentOwnerType.Comment => await ResolveCommentAsync(ownerId, cancellationToken),
            AttachmentOwnerType.ActivityLog => await ResolveActivityLogAsync(ownerId, cancellationToken),
            _ => null
        };
    }

    private Task<FileOwnerContext?> ResolveMessageAsync(Guid messageId, CancellationToken cancellationToken)
    {
        return dbContext.Messages
            .AsNoTracking()
            .Where(message => message.Id == messageId && !message.DeletedAt.HasValue)
            .Select(message => new FileOwnerContext(message.Conversation!.WorkspaceId, null, message.ConversationId, null, message.AuthorUserId))
            .FirstOrDefaultAsync(cancellationToken);
    }

    private Task<FileOwnerContext?> ResolvePostAsync(Guid postId, CancellationToken cancellationToken)
    {
        return dbContext.Posts
            .AsNoTracking()
            .Where(post => post.Id == postId && !post.DeletedAt.HasValue)
            .Select(post => new FileOwnerContext(post.Channel!.WorkspaceId, null, null, post.ChannelId, post.AuthorUserId))
            .FirstOrDefaultAsync(cancellationToken);
    }

    private Task<FileOwnerContext?> ResolveTaskAsync(Guid taskId, CancellationToken cancellationToken)
    {
        return dbContext.TaskItems
            .AsNoTracking()
            .Where(task => task.Id == taskId && !task.DeletedAt.HasValue)
            .Select(task => new FileOwnerContext(task.Project!.WorkspaceId, task.ProjectId, null, null, task.CreatedByUserId))
            .FirstOrDefaultAsync(cancellationToken);
    }

    private Task<FileOwnerContext?> ResolveArtifactVersionAsync(Guid versionId, CancellationToken cancellationToken)
    {
        return dbContext.ArtifactVersions
            .AsNoTracking()
            .Where(version => version.Id == versionId && !version.DeletedAt.HasValue && !version.Artifact!.DeletedAt.HasValue)
            .Select(version => new FileOwnerContext(version.Artifact!.Project!.WorkspaceId, version.Artifact.ProjectId, null, null, version.CreatedByUserId))
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<FileOwnerContext?> ResolveCommentAsync(Guid commentId, CancellationToken cancellationToken)
    {
        var comment = await dbContext.Comments
            .AsNoTracking()
            .Where(comment => comment.Id == commentId && !comment.DeletedAt.HasValue)
            .FirstOrDefaultAsync(cancellationToken);

        if (comment is null)
        {
            return null;
        }

        var projectId = comment.TargetType switch
        {
            CommentTargetType.Project => comment.TargetId,
            CommentTargetType.TaskItem => await dbContext.TaskItems.AsNoTracking().Where(task => task.Id == comment.TargetId).Select(task => (Guid?)task.ProjectId).FirstOrDefaultAsync(cancellationToken),
            CommentTargetType.Milestone => await dbContext.Milestones.AsNoTracking().Where(milestone => milestone.Id == comment.TargetId).Select(milestone => (Guid?)milestone.ProjectId).FirstOrDefaultAsync(cancellationToken),
            CommentTargetType.Artifact => await dbContext.Artifacts.AsNoTracking().Where(artifact => artifact.Id == comment.TargetId).Select(artifact => (Guid?)artifact.ProjectId).FirstOrDefaultAsync(cancellationToken),
            CommentTargetType.ArtifactVersion => await dbContext.ArtifactVersions.AsNoTracking().Where(version => version.Id == comment.TargetId).Select(version => (Guid?)version.Artifact!.ProjectId).FirstOrDefaultAsync(cancellationToken),
            CommentTargetType.ActivityLog => await dbContext.ActivityLogs.AsNoTracking().Where(log => log.Id == comment.TargetId).Select(log => (Guid?)log.ProjectId).FirstOrDefaultAsync(cancellationToken),
            _ => null
        };

        return new FileOwnerContext(comment.WorkspaceId, projectId, null, null, comment.AuthorUserId);
    }

    private Task<FileOwnerContext?> ResolveActivityLogAsync(Guid activityLogId, CancellationToken cancellationToken)
    {
        return dbContext.ActivityLogs
            .AsNoTracking()
            .Where(log => log.Id == activityLogId)
            .Select(log => new FileOwnerContext(log.Project!.WorkspaceId, log.ProjectId, null, null, log.AuthorUserId))
            .FirstOrDefaultAsync(cancellationToken);
    }
}
