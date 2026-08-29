using AipPortal.Application.Common;
using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

public interface IMessageFollowUpRepository
{
    Task<PagedResponse<MessageFollowUp>> ListVisibleAsync(
        Guid userId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<MessageFollowUp?> GetAsync(
        Guid userId,
        Guid messageId,
        CancellationToken cancellationToken = default);

    Task AddAsync(MessageFollowUp followUp, CancellationToken cancellationToken = default);
    void Remove(MessageFollowUp followUp);
}
