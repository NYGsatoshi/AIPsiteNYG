using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

public interface IFileDownloadGrantRepository
{
    Task<FileDownloadGrant?> GetAsync(Guid fileDownloadGrantId, CancellationToken cancellationToken = default);

    Task AddAsync(FileDownloadGrant grant, CancellationToken cancellationToken = default);
}
