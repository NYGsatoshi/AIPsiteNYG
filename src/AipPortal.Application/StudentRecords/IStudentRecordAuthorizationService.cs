using AipPortal.Domain.Entities;

namespace AipPortal.Application.StudentRecords;

public interface IStudentRecordAuthorizationService
{
    Task<bool> CanViewPublicStudentRecordAsync(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default);
    Task<StudentRecordRestrictedAccess> AuthorizeRestrictedStudentRecordAsync(
        Guid userId,
        StudentRecord record,
        IReadOnlyCollection<string> requestedFields,
        CancellationToken cancellationToken = default);
}
