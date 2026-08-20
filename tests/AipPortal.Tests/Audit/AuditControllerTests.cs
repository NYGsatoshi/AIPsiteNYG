using AipPortal.Application.Audit;
using AipPortal.Application.Common;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace AipPortal.Tests.Audit;

public sealed class AuditControllerTests
{
    [Fact]
    public async Task AdminAuditGrid_UsesGridDefaultWhenPageSizeIsOmitted()
    {
        var audit = new CapturingAuditQueryService();
        var controller = CreateController(audit);

        var result = await controller.AdminAuditGrid(new AuditLogQuery(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        var capturedQuery = Assert.IsType<AuditLogQuery>(audit.LastGridQuery);
        Assert.Equal(100, capturedQuery.PageSize);
        Assert.Equal(1, capturedQuery.Page);
    }

    [Fact]
    public async Task AdminAuditGrid_PreservesExplicitPageSize()
    {
        var audit = new CapturingAuditQueryService();
        var controller = CreateController(audit, "?page=2&pageSize=50");

        var result = await controller.AdminAuditGrid(
            new AuditLogQuery(Page: 2, PageSize: 50),
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        var capturedQuery = Assert.IsType<AuditLogQuery>(audit.LastGridQuery);
        Assert.Equal(50, capturedQuery.PageSize);
        Assert.Equal(2, capturedQuery.Page);
    }

    private static AuditController CreateController(
        CapturingAuditQueryService audit,
        string? queryString = null)
    {
        var services = new ServiceCollection()
            .AddSingleton<IRedactionService, CanonicalRedactionService>()
            .BuildServiceProvider();
        var controller = new AuditController(audit)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    RequestServices = services
                }
            }
        };

        if (!string.IsNullOrWhiteSpace(queryString))
        {
            controller.Request.QueryString = new QueryString(queryString);
        }

        return controller;
    }

    private sealed class CapturingAuditQueryService : IAuditQueryService
    {
        public AuditLogQuery? LastGridQuery { get; private set; }

        public Task<Result<PagedResponse<AuditLogListItemResponse>>> ListAuditLogsAsync(
            AuditLogQuery query,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result<PagedResponse<AuditLogListItemResponse>>.Success(
                new PagedResponse<AuditLogListItemResponse>(
                    Array.Empty<AuditLogListItemResponse>(),
                    query.Page,
                    query.PageSize,
                    0)));
        }

        public Task<Result<PagedResponse<AuditGridRowResponse>>> ListAuditGridAsync(
            AuditLogQuery query,
            CancellationToken cancellationToken = default)
        {
            LastGridQuery = query;
            return Task.FromResult(Result<PagedResponse<AuditGridRowResponse>>.Success(
                new PagedResponse<AuditGridRowResponse>(
                    Array.Empty<AuditGridRowResponse>(),
                    query.Page,
                    query.PageSize,
                    0)));
        }

        public Task<Result<PagedResponse<SecurityEventListItemResponse>>> ListSecurityEventsAsync(
            SecurityEventQuery query,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result<PagedResponse<SecurityEventListItemResponse>>.Success(
                new PagedResponse<SecurityEventListItemResponse>(
                    Array.Empty<SecurityEventListItemResponse>(),
                    query.Page,
                    query.PageSize,
                    0)));
        }
    }
}
