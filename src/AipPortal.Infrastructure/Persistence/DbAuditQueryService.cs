using AipPortal.Application.Audit;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class DbAuditQueryService(
    AppDbContext dbContext,
    IAuditAuthorizationService auditAuthorization,
    ICurrentTenant currentTenant) : IAuditQueryService
{
    private const int MaxPageSize = 100;

    public async Task<Result<PagedResponse<AuditLogListItemResponse>>> ListAuditLogsAsync(
        AuditLogQuery query,
        CancellationToken cancellationToken = default)
    {
        var capabilities = await auditAuthorization.GetCapabilitiesAsync(cancellationToken);
        if (!capabilities.CanView)
        {
            var denied = await auditAuthorization.AuthorizeAsync(
                CapabilityKeys.AuditView,
                "audit.logs.list",
                cancellationToken);
            return Result<PagedResponse<AuditLogListItemResponse>>.Failure(denied.ErrorDetail!);
        }

        if (query.ActorUserId.HasValue && !capabilities.CanViewSensitiveMetadata)
        {
            var denied = await auditAuthorization.AuthorizeAsync(
                CapabilityKeys.AuditSensitiveMetadataView,
                "audit.logs.filter.actor",
                cancellationToken);
            return Result<PagedResponse<AuditLogListItemResponse>>.Failure(denied.ErrorDetail!);
        }

        var scopeError = ValidateQueryScope<PagedResponse<AuditLogListItemResponse>>();
        if (scopeError is not null)
        {
            return scopeError;
        }

        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);
        var source = ScopeToCurrentTenant(dbContext.AuditLogs.AsNoTracking());

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
        var canViewSensitiveMetadata = capabilities.CanViewSensitiveMetadata;
        var items = await source
            .OrderByDescending(log => log.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(log => new AuditLogListItemResponse(
                log.Id,
                canViewSensitiveMetadata ? log.ActorUserId : null,
                canViewSensitiveMetadata
                    ? (log.ActorUser == null ? null : log.ActorUser.DisplayName)
                    : null,
                log.Action,
                log.EntityType,
                log.EntityId,
                log.WorkspaceId,
                log.GroupId,
                log.ProjectId,
                log.Summary,
                canViewSensitiveMetadata ? log.MetadataJson : null,
                canViewSensitiveMetadata ? log.CorrelationId : null,
                log.CreatedAt))
            .ToListAsync(cancellationToken);

        return Result<PagedResponse<AuditLogListItemResponse>>.Success(
            new PagedResponse<AuditLogListItemResponse>(items, page, pageSize, total));
    }

    public async Task<Result<PagedResponse<AuditGridRowResponse>>> ListAuditGridAsync(
        AuditLogQuery query,
        CancellationToken cancellationToken = default)
    {
        var capabilities = await auditAuthorization.GetCapabilitiesAsync(cancellationToken);
        if (!capabilities.CanView)
        {
            var denied = await auditAuthorization.AuthorizeAsync(
                CapabilityKeys.AuditView,
                "audit.grid.list",
                cancellationToken);
            return Result<PagedResponse<AuditGridRowResponse>>.Failure(denied.ErrorDetail!);
        }

        if (query.ActorUserId.HasValue && !capabilities.CanViewSensitiveMetadata)
        {
            var denied = await auditAuthorization.AuthorizeAsync(
                CapabilityKeys.AuditSensitiveMetadataView,
                "audit.grid.filter.actor",
                cancellationToken);
            return Result<PagedResponse<AuditGridRowResponse>>.Failure(denied.ErrorDetail!);
        }

        var scopeError = ValidateQueryScope<PagedResponse<AuditGridRowResponse>>();
        if (scopeError is not null)
        {
            return scopeError;
        }

        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);
        var source = ScopeToCurrentTenant(dbContext.AuditLogs.AsNoTracking());

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
        var records = await source
            .OrderByDescending(log => log.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(log => new
            {
                log.Id,
                log.CreatedAt,
                log.Action,
                ActorDisplayName = log.ActorUser == null ? null : log.ActorUser.DisplayName,
                log.EntityType,
                WorkspaceLabel = log.Workspace == null ? null : log.Workspace.Name,
                log.WorkspaceId,
                log.Summary,
                log.CorrelationId
            })
            .ToListAsync(cancellationToken);

        var canViewSensitiveMetadata = capabilities.CanViewSensitiveMetadata;
        var items = records
            .Select(log =>
            {
                var result = ClassifyResult(log.Action);
                return new AuditGridRowResponse(
                    log.Id,
                    log.CreatedAt,
                    log.Action,
                    canViewSensitiveMetadata
                        ? (string.IsNullOrWhiteSpace(log.ActorDisplayName) ? "Unknown actor" : log.ActorDisplayName)
                        : "Redacted actor",
                    log.EntityType,
                    log.WorkspaceLabel ?? log.WorkspaceId?.ToString("D"),
                    ClassifySeverity(log.Action, result),
                    result,
                    string.IsNullOrWhiteSpace(log.Summary) ? log.Action : log.Summary,
                    canViewSensitiveMetadata ? log.CorrelationId : null);
            })
            .ToList();

        return Result<PagedResponse<AuditGridRowResponse>>.Success(
            new PagedResponse<AuditGridRowResponse>(items, page, pageSize, total));
    }

    public async Task<Result<PagedResponse<SecurityEventListItemResponse>>> ListSecurityEventsAsync(
        SecurityEventQuery query,
        CancellationToken cancellationToken = default)
    {
        var capabilities = await auditAuthorization.GetCapabilitiesAsync(cancellationToken);
        if (!capabilities.CanView)
        {
            var denied = await auditAuthorization.AuthorizeAsync(
                CapabilityKeys.AuditView,
                "audit.security-events.list",
                cancellationToken);
            return Result<PagedResponse<SecurityEventListItemResponse>>.Failure(denied.ErrorDetail!);
        }

        if ((query.UserId.HasValue || !string.IsNullOrWhiteSpace(query.Email)) &&
            !capabilities.CanViewSensitiveMetadata)
        {
            var denied = await auditAuthorization.AuthorizeAsync(
                CapabilityKeys.AuditSensitiveMetadataView,
                "audit.security-events.filter.identity",
                cancellationToken);
            return Result<PagedResponse<SecurityEventListItemResponse>>.Failure(denied.ErrorDetail!);
        }

        var scopeError = ValidateQueryScope<PagedResponse<SecurityEventListItemResponse>>();
        if (scopeError is not null)
        {
            return scopeError;
        }

        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);
        var source = ScopeToCurrentTenant(dbContext.SecurityEvents.AsNoTracking());

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
            source = source.Where(item =>
                item.Email != null && EF.Functions.ILike(item.Email, $"%{query.Email.Trim()}%"));
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
        var canViewSensitiveMetadata = capabilities.CanViewSensitiveMetadata;
        var items = await source
            .OrderByDescending(item => item.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(item => new SecurityEventListItemResponse(
                item.Id,
                item.EventType,
                canViewSensitiveMetadata ? item.UserId : null,
                canViewSensitiveMetadata ? item.Email : null,
                canViewSensitiveMetadata ? item.IpAddress : null,
                canViewSensitiveMetadata ? item.UserAgent : null,
                item.Severity,
                item.Summary,
                canViewSensitiveMetadata ? item.MetadataJson : null,
                item.CreatedAt))
            .ToListAsync(cancellationToken);

        return Result<PagedResponse<SecurityEventListItemResponse>>.Success(
            new PagedResponse<SecurityEventListItemResponse>(items, page, pageSize, total));
    }

    private IQueryable<T> ScopeToCurrentTenant<T>(IQueryable<T> source) where T : class
    {
        if (currentTenant is not { IsAvailable: true, IsPlatformScope: false })
        {
            return source;
        }

        return source switch
        {
            IQueryable<AipPortal.Domain.Entities.AuditLog> auditLogs =>
                (IQueryable<T>)auditLogs.Where(log => log.TenantId == currentTenant.TenantId),
            IQueryable<AipPortal.Domain.Entities.SecurityEvent> securityEvents =>
                (IQueryable<T>)securityEvents.Where(item => item.TenantId == currentTenant.TenantId),
            _ => source
        };
    }

    private Result<T>? ValidateQueryScope<T>()
    {
        if (currentTenant.IsPlatformScope || currentTenant.IsAvailable)
        {
            return null;
        }

        return Result<T>.Failure(new ApplicationErrorDetail(
            "TenantMembershipRequired",
            "A Tenant or explicit platform Audit scope is required."));
    }

    private static string ClassifyResult(string action)
    {
        if (ContainsAny(action, "denied", "unauthorized", "forbidden", "rejected"))
        {
            return "denied";
        }

        if (ContainsAny(action, "failed", "failure", "error", "exception", "lockout"))
        {
            return "failed";
        }

        return "success";
    }

    private static string ClassifySeverity(string action, string result)
    {
        if (ContainsAny(action, "critical", "failed", "lockout", "suspicious", "infected", "quarantine"))
        {
            return "critical";
        }

        if (result == "denied" ||
            ContainsAny(action, "failure", "warning", "rejected", "rate", "revoked", "expired", "blocked"))
        {
            return "warning";
        }

        return "info";
    }

    private static bool ContainsAny(string value, params string[] needles)
    {
        return needles.Any(needle => value.Contains(needle, StringComparison.OrdinalIgnoreCase));
    }
}
