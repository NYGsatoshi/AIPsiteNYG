using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class FileDownloadGrantRepository(AppDbContext dbContext) : IFileDownloadGrantRepository
{
    public Task<FileDownloadGrant?> GetAsync(Guid fileDownloadGrantId, CancellationToken cancellationToken = default)
    {
        return dbContext.FileDownloadGrants
            .FirstOrDefaultAsync(grant => grant.Id == fileDownloadGrantId, cancellationToken);
    }

    public async Task AddAsync(FileDownloadGrant grant, CancellationToken cancellationToken = default)
    {
        await dbContext.FileDownloadGrants.AddAsync(grant, cancellationToken);
    }
}
