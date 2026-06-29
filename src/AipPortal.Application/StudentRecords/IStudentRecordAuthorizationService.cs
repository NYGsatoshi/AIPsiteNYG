namespace AipPortal.Application.StudentRecords;

public interface IStudentRecordAuthorizationService
{
    Task<bool> CanViewPublicStudentRecordAsync(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default);
    Task<bool> CanReadRestrictedStudentRecordAsync(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default);
}
