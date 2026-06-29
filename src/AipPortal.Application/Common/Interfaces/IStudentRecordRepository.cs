using AipPortal.Domain.Entities;

namespace AipPortal.Application.Common.Interfaces;

public interface IStudentRecordRepository
{
    Task<StudentRecord?> GetByIdAsync(Guid studentRecordId, CancellationToken cancellationToken = default);
    Task AddAsync(StudentRecord studentRecord, CancellationToken cancellationToken = default);
}
