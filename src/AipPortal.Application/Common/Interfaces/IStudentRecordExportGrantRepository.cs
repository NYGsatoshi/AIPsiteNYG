using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

public interface IStudentRecordExportGrantRepository
{
    Task<ExportPackageGrant?> GetAsync(Guid exportPackageGrantId, CancellationToken cancellationToken = default);

    Task AddAsync(ExportPackageGrant grant, CancellationToken cancellationToken = default);
}
