using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Common.Interfaces;

public interface ITenantExportRepository
{
    Task<Tenant?> GetTenantAsync(Guid tenantId, CancellationToken cancellationToken = default);

    Task<ExportJob?> GetExportJobAsync(Guid exportJobId, CancellationToken cancellationToken = default);

    Task AddExportJobAsync(ExportJob exportJob, CancellationToken cancellationToken = default);

    Task<byte[]> CreateMetadataZipAsync(Guid tenantId, CancellationToken cancellationToken = default);
}
