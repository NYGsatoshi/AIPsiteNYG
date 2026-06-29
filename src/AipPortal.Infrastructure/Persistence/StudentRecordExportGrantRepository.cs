using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class StudentRecordExportGrantRepository(AppDbContext dbContext) : IStudentRecordExportGrantRepository
{
    public Task<ExportPackageGrant?> GetAsync(Guid exportPackageGrantId, CancellationToken cancellationToken = default)
    {
        return dbContext.ExportPackageGrants
            .FirstOrDefaultAsync(grant => grant.Id == exportPackageGrantId, cancellationToken);
    }

    public async Task AddAsync(ExportPackageGrant grant, CancellationToken cancellationToken = default)
    {
        await dbContext.ExportPackageGrants.AddAsync(grant, cancellationToken);
    }
}
