using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.StudentRecords;

public sealed class StudentRecordAuthorizationService(IWorkspaceRepository workspaces) : IStudentRecordAuthorizationService
{
    public async Task<bool> CanViewPublicStudentRecordAsync(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default)
    {
        var member = await workspaces.GetMemberAsync(workspaceId, userId, cancellationToken);
        return member is { Status: MembershipStatus.Active };
    }

    public async Task<bool> CanReadRestrictedStudentRecordAsync(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default)
    {
        var member = await workspaces.GetMemberAsync(workspaceId, userId, cancellationToken);
        return member is { Status: MembershipStatus.Active, Role: WorkspaceRole.Owner or WorkspaceRole.Admin };
    }
}
