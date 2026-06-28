using AipPortal.Application.Audit;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class DbAuditQueryService(
    AppDbContext dbContext,
    ICurrentUser currentUser,
    ICurrentTenant currentTenant,
    ITenantRepository tenantRepository,
    IWorkspaceAuthorizationService workspaceAuthorization) : IAuditQueryService
{
    private const int MaxPageSize = 100;

    public async Task<Result<PagedResponse<AuditLogListItemResponse>>> ListAuditLogsAsync(AuditLogQuery query, CancellationToken cancellationToken = default)
    {
        if (!currentUser.IsAuthenticated || !currentUser.UserId.HasValue)
        {
            return Result<PagedResponse<AuditLogListItemResponse>>.Failure("Authentication is required.");
        }

        var userId = currentUser.UserId.Value;
        var isSystemAdmin = currentUser.SystemRole is SystemRole.SystemAdmin or SystemRole.PlatformAdmin;
        var isTenantAdmin = currentTenant.IsAvailable &&
            await IsTenantAdminAsync(userId, currentTenant.TenantId, cancellationToken);
        if (!isSystemAdmin && !isTenantAdmin)
        {
            return Result<PagedResponse<AuditLogListItemResponse>>.Failure("You are not allowed to view audit logs.");
        }

        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);
        var source = dbContext.AuditLogs.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(query.Action))
        {
            source = source.Where(log => log.Action == query.Action);
        }

        if (!string.IsNullOrWhiteSpace(query.EntityType))
        {
            source = source.Where(log => log.EntityType == query.EntityType);
        }

        if (query.ActorUserId.HasValue)
        {
            source = source.Where(log => log.ActorUserId == query.ActorUserId);
        }

        if (query.WorkspaceId.HasValue)
        {
            source = source.Where(log => log.WorkspaceId == query.WorkspaceId);
        }

        if (query.GroupId.HasValue)
        {
            source = source.Where(log => log.GroupId == query.GroupId);
        }

        if (query.ProjectId.HasValue)
        {
            source = source.Where(log => log.ProjectId == query.ProjectId);
        }

        if (query.FromDate.HasValue)
        {
            source = source.Where(log => log.CreatedAt >= query.FromDate.Value);
        }

        if (query.ToDate.HasValue)
        {
            source = source.Where(log => log.CreatedAt <= query.ToDate.Value);
        }

        var total = await source.CountAsync(cancellationToken);
        var items = await source
            .OrderByDescending(log => log.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(log => new AuditLogListItemResponse(
                log.Id,
                log.ActorUserId,
                log.ActorUser == null ? null : log.ActorUser.DisplayName,
                log.Action,
                log.EntityType,
                log.EntityId,
                log.WorkspaceId,
                log.GroupId,
                log.ProjectId,
                log.Summary,
                log.MetadataJson,
                log.CorrelationId,
                log.CreatedAt))
            .ToListAsync(cancellationToken);

        return Result<PagedResponse<AuditLogListItemResponse>>.Success(new PagedResponse<AuditLogListItemResponse>(items, page, pageSize, total));
    }

    public async Task<Result<PagedResponse<SecurityEventListItemResponse>>> ListSecurityEventsAsync(SecurityEventQuery query, CancellationToken cancellationToken = default)
    {
        if (!currentUser.IsAuthenticated || !currentUser.UserId.HasValue)
        {
            return Result<PagedResponse<SecurityEventListItemResponse>>.Failure("Authentication is required.");
        }

        var isSystemAdmin = currentUser.SystemRole is SystemRole.SystemAdmin or SystemRole.PlatformAdmin;
        var isTenantAdmin = currentTenant.IsAvailable &&
            await IsTenantAdminAsync(currentUser.UserId.Value, currentTenant.TenantId, cancellationToken);

        if (!isSystemAdmin && !isTenantAdmin)
        {
            return Result<PagedResponse<SecurityEventListItemResponse>>.Failure("Only system admins can view security events.");
        }

        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);
        var source = dbContext.SecurityEvents.AsNoTracking();

        if (query.EventType.HasValue)
        {
            source = source.Where(item => item.EventType == query.EventType);
        }

        if (query.Severity.HasValue)
        {
            source = source.Where(item => item.Severity == query.Severity);
        }

        if (query.UserId.HasValue)
        {
            source = source.Where(item => item.UserId == query.UserId);
        }

        if (!string.IsNullOrWhiteSpace(query.Email))
        {
            source = source.Where(item => item.Email != null && EF.Functions.ILike(item.Email, $"%{query.Email.Trim()}%"));
        }

        if (query.FromDate.HasValue)
        {
            source = source.Where(item => item.CreatedAt >= query.FromDate.Value);
        }

        if (query.ToDate.HasValue)
        {
            source = source.Where(item => item.CreatedAt <= query.ToDate.Value);
        }

        var total = await source.CountAsync(cancellationToken);
        var items = await source
            .OrderByDescending(item => item.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(item => new SecurityEventListItemResponse(
                item.Id,
                item.EventType,
                item.UserId,
                item.Email,
                item.IpAddress,
                item.UserAgent,
                item.Severity,
                item.Summary,
                item.MetadataJson,
                item.CreatedAt))
            .ToListAsync(cancellationToken);

        return Result<PagedResponse<SecurityEventListItemResponse>>.Success(new PagedResponse<SecurityEventListItemResponse>(items, page, pageSize, total));
    }

    private async Task<bool> IsTenantAdminAsync(Guid userId, Guid tenantId, CancellationToken cancellationToken)
    {
        var membership = await tenantRepository.GetTenantUserAsync(tenantId, userId, cancellationToken);
        return membership is
        {
            Status: TenantUserStatus.Active,
            Role: TenantUserRole.Owner or TenantUserRole.Admin
        };
    }
}
