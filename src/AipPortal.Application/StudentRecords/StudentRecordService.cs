using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.StudentRecords;

public sealed class StudentRecordService(
    IStudentRecordRepository studentRecords,
    IStudentRecordAuthorizationService authorization,
    ICurrentUser currentUser,
    ICurrentTenant currentTenant,
    IAuditLogger auditLogger) : IStudentRecordService
{
    public async Task<Result<StudentRecordPublicResponse>> GetPublicAsync(Guid studentRecordId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !currentTenant.IsAvailable)
        {
            return Result<StudentRecordPublicResponse>.Failure("Student record not found.");
        }

        var record = await studentRecords.GetByIdAsync(studentRecordId, cancellationToken);
        if (record is null ||
            record.TenantId != currentTenant.TenantId ||
            !await authorization.CanViewPublicStudentRecordAsync(userId, record.WorkspaceId, cancellationToken))
        {
            return Result<StudentRecordPublicResponse>.Failure("Student record not found.");
        }

        return Result<StudentRecordPublicResponse>.Success(StudentRecordDataPolicy.ToPublicResponse(record));
    }

    public async Task<Result<StudentRecordRestrictedResponse>> GetRestrictedAsync(
        Guid studentRecordId,
        StudentRecordRestrictedRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !currentTenant.IsAvailable)
        {
            return Result<StudentRecordRestrictedResponse>.Failure("Student record not found.");
        }

        var record = await studentRecords.GetByIdAsync(studentRecordId, cancellationToken);
        if (record is null || record.TenantId != currentTenant.TenantId)
        {
            return Result<StudentRecordRestrictedResponse>.Failure("Student record not found.");
        }

        var requestedFields = NormalizeRequestedFields(request.Fields);
        var access = await authorization.AuthorizeRestrictedStudentRecordAsync(userId, record, requestedFields, cancellationToken);
        if (!access.IsAuthorizedForRecord)
        {
            await AuditRestrictedDenialAsync(userId, record, requestedFields, access, cancellationToken);
            return Result<StudentRecordRestrictedResponse>.Failure("Student record not found.");
        }

        var publicResponse = request.IncludePublic
            ? StudentRecordDataPolicy.ToPublicResponse(record)
            : null;
        var restrictedFields = StudentRecordDataPolicy.ProjectRestrictedFields(record, access.AllowedFields);

        return Result<StudentRecordRestrictedResponse>.Success(new StudentRecordRestrictedResponse(
            record.Id,
            record.WorkspaceId,
            publicResponse,
            restrictedFields));
    }

    private static IReadOnlyList<string> NormalizeRequestedFields(IReadOnlyCollection<string> fields)
    {
        return fields
            .Where(field => !string.IsNullOrWhiteSpace(field))
            .Select(field => field.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private async Task AuditRestrictedDenialAsync(
        Guid userId,
        StudentRecord record,
        IReadOnlyCollection<string> requestedFields,
        StudentRecordRestrictedAccess access,
        CancellationToken cancellationToken)
    {
        var knownRestrictedFields = requestedFields
            .Where(StudentRecordDataPolicy.IsKnownRestrictedField)
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var unknownFieldCount = requestedFields.Count - knownRestrictedFields.Length;

        await auditLogger.LogSecurityAsync(
            "AccessDenied",
            "StudentRecordRestricted access denied.",
            new Dictionary<string, object?>
            {
                ["classification"] = DataClassification.StudentRecordRestricted.ToString(),
                ["studentRecordId"] = record.Id,
                ["workspaceId"] = record.WorkspaceId,
                ["schoolRole"] = access.Role?.ToString(),
                ["decisionReason"] = access.Reason,
                ["requestedRestrictedFields"] = string.Join(",", knownRestrictedFields),
                ["unknownFieldCount"] = unknownFieldCount
            },
            SecurityEventSeverity.Warning,
            cancellationToken);
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }
}
