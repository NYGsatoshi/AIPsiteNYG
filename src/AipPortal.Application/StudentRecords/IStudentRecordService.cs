using AipPortal.Application.Common;

namespace AipPortal.Application.StudentRecords;

public interface IStudentRecordService
{
    Task<Result<StudentRecordPublicResponse>> GetPublicAsync(Guid studentRecordId, CancellationToken cancellationToken = default);
    Task<Result<StudentRecordRestrictedResponse>> GetRestrictedAsync(Guid studentRecordId, StudentRecordRestrictedRequest request, CancellationToken cancellationToken = default);
}
