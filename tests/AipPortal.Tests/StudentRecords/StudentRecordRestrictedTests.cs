using System.Text.Json;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.StudentRecords;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Tests.StudentRecords;

public sealed class StudentRecordRestrictedTests
{
    [Fact]
    public void StudentRecordRestrictedFieldsAreClassified()
    {
        Assert.Equal(DataClassification.StudentRecordRestricted, StudentRecordDataPolicy.Classify(StudentRecordDataPolicy.HealthNotes));
        Assert.Equal(DataClassification.StudentRecordRestricted, StudentRecordDataPolicy.Classify(StudentRecordDataPolicy.GuardianContact));
        Assert.Equal(DataClassification.StudentRecordRestricted, StudentRecordDataPolicy.Classify(StudentRecordDataPolicy.Grades));
        Assert.Equal(DataClassification.StudentRecordRestricted, StudentRecordDataPolicy.Classify(StudentRecordDataPolicy.AttendanceStatus));
        Assert.Equal(DataClassification.Public, StudentRecordDataPolicy.Classify(StudentRecordDataPolicy.PublicDisplayName));
        Assert.Equal(DataClassification.Public, StudentRecordDataPolicy.Classify(StudentRecordDataPolicy.HomeroomLabel));
        Assert.Equal(DataClassification.UnknownSensitive, StudentRecordDataPolicy.Classify("internalSensitiveNotes"));
    }

    [Fact]
    public async Task UnauthorizedCallerCannotReadStudentRecordRestrictedValues()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.ExternalGuest));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.DoesNotContain(fixture.Record.HealthNotes!, JsonSerializer.Serialize(result));
        Assert.DoesNotContain(fixture.Record.GuardianContact!, JsonSerializer.Serialize(result));
        Assert.DoesNotContain(fixture.Record.Grades!, JsonSerializer.Serialize(result));
        Assert.DoesNotContain(fixture.Record.AttendanceStatus!.Value.ToString(), JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task UnauthorizedDenialAuditDoesNotContainRestrictedValues()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.ExternalGuest));

        await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        var entry = Assert.Single(fixture.Audit.Entries);
        var serialized = JsonSerializer.Serialize(entry);
        Assert.Contains(DataClassification.StudentRecordRestricted.ToString(), serialized);
        Assert.Contains(StudentRecordDataPolicy.HealthNotes, serialized);
        Assert.DoesNotContain(fixture.Record.HealthNotes!, serialized);
        Assert.DoesNotContain(fixture.Record.GuardianContact!, serialized);
        Assert.DoesNotContain(fixture.Record.Grades!, serialized);
        Assert.DoesNotContain(fixture.Record.InternalSensitiveNotes!, serialized);
    }

    [Fact]
    public async Task AuthorizedScopedCallerCanReadOnlyRequestedRestrictedValues()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.SchoolAdmin, HasSchoolAdminScope: true));

        var result = await fixture.Service.GetRestrictedAsync(
            fixture.Record.Id,
            new StudentRecordRestrictedRequest(
                [StudentRecordDataPolicy.HealthNotes, "internalSensitiveNotes"],
                IncludePublic: true));

        Assert.True(result.IsSuccess);
        var response = result.Value!;
        Assert.Equal(fixture.Record.PublicDisplayName, response.Public!.PublicDisplayName);
        Assert.Equal(fixture.Record.HomeroomLabel, response.Public.HomeroomLabel);
        Assert.Equal(fixture.Record.HealthNotes, response.RestrictedFields[StudentRecordDataPolicy.HealthNotes]);
        Assert.DoesNotContain(StudentRecordDataPolicy.Grades, response.RestrictedFields.Keys);
        Assert.DoesNotContain("internalSensitiveNotes", response.RestrictedFields.Keys);
        Assert.DoesNotContain(fixture.Record.InternalSensitiveNotes!, JsonSerializer.Serialize(response));
    }

    [Fact]
    public async Task UnknownSensitiveStudentFieldIsFailClosedByDefault()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.SchoolAdmin, HasSchoolAdminScope: true));

        var result = await fixture.Service.GetRestrictedAsync(
            fixture.Record.Id,
            new StudentRecordRestrictedRequest(["internalSensitiveNotes"]));

        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value!.RestrictedFields);
        Assert.DoesNotContain(fixture.Record.InternalSensitiveNotes!, JsonSerializer.Serialize(result.Value));
    }

    [Fact]
    public async Task GuardianCanReadOnlyPolicyPermittedFieldsOfLinkedStudent()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(
            SchoolRole.Guardian,
            HasGuardianRelationship: true));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.True(result.IsSuccess);
        var fields = result.Value!.RestrictedFields;
        Assert.Equal(fixture.Record.GuardianContact, fields[StudentRecordDataPolicy.GuardianContact]);
        Assert.Equal(fixture.Record.AttendanceStatus!.Value.ToString(), fields[StudentRecordDataPolicy.AttendanceStatus]);
        Assert.DoesNotContain(StudentRecordDataPolicy.Grades, fields.Keys);
        Assert.DoesNotContain(StudentRecordDataPolicy.HealthNotes, fields.Keys);
    }

    [Fact]
    public async Task GuardianCannotReadUnlinkedStudentRestrictedRecord()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.Guardian));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Record.HealthNotes!, JsonSerializer.Serialize(result));
        Assert.DoesNotContain(fixture.Record.GuardianContact!, JsonSerializer.Serialize(result));
        Assert.DoesNotContain(fixture.Record.Grades!, JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task StudentCanReadOnlySelfPolicyPermittedFields()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.Student, IsSelf: true));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.True(result.IsSuccess);
        var fields = result.Value!.RestrictedFields;
        Assert.Equal(fixture.Record.AttendanceStatus!.Value.ToString(), fields[StudentRecordDataPolicy.AttendanceStatus]);
        Assert.DoesNotContain(StudentRecordDataPolicy.HealthNotes, fields.Keys);
        Assert.DoesNotContain(StudentRecordDataPolicy.GuardianContact, fields.Keys);
        Assert.DoesNotContain(StudentRecordDataPolicy.Grades, fields.Keys);
    }

    [Fact]
    public async Task TeacherOutsideScopeCannotReadRestrictedStudentRecord()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.Teacher));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Record.HealthNotes!, JsonSerializer.Serialize(result));
        Assert.DoesNotContain(fixture.Record.Grades!, JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task HomeroomTeacherCanReadOnlyPolicyPermittedFieldsWithinHomeroomScope()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(
            SchoolRole.HomeroomTeacher,
            HasHomeroomScope: true));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.True(result.IsSuccess);
        var fields = result.Value!.RestrictedFields;
        Assert.Equal(fixture.Record.HealthNotes, fields[StudentRecordDataPolicy.HealthNotes]);
        Assert.Equal(fixture.Record.Grades, fields[StudentRecordDataPolicy.Grades]);
        Assert.DoesNotContain(StudentRecordDataPolicy.GuardianContact, fields.Keys);
    }

    [Fact]
    public async Task GradeTeacherCanReadOnlyPolicyPermittedFieldsWithinGradeScope()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(
            SchoolRole.GradeTeacher,
            HasGradeScope: true));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.True(result.IsSuccess);
        var fields = result.Value!.RestrictedFields;
        Assert.Equal(fixture.Record.Grades, fields[StudentRecordDataPolicy.Grades]);
        Assert.Equal(fixture.Record.AttendanceStatus!.Value.ToString(), fields[StudentRecordDataPolicy.AttendanceStatus]);
        Assert.DoesNotContain(StudentRecordDataPolicy.HealthNotes, fields.Keys);
        Assert.DoesNotContain(StudentRecordDataPolicy.GuardianContact, fields.Keys);
    }

    [Fact]
    public async Task ExternalGuestCannotAccessStudentRecordRestricted()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.ExternalGuest));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Record.HealthNotes!, JsonSerializer.Serialize(result));
        Assert.DoesNotContain(fixture.Record.GuardianContact!, JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task MissingRoleFailsClosed()
    {
        var fixture = new Fixture(null);

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Record.HealthNotes!, JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task MissingGuardianRelationshipFailsClosed()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.Guardian));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Record.GuardianContact!, JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task MissingTeacherScopeFailsClosed()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(SchoolRole.Teacher));

        var result = await fixture.Service.GetRestrictedAsync(fixture.Record.Id, RestrictedRequest());

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Record.Grades!, JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task MissingFieldAccessPolicyForRoleOmitsRestrictedField()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(
            SchoolRole.StudentAdmin,
            HasStudentAdminScope: true));

        var result = await fixture.Service.GetRestrictedAsync(
            fixture.Record.Id,
            new StudentRecordRestrictedRequest([StudentRecordDataPolicy.HealthNotes, StudentRecordDataPolicy.Grades]));

        Assert.True(result.IsSuccess);
        var fields = result.Value!.RestrictedFields;
        Assert.Equal(fixture.Record.Grades, fields[StudentRecordDataPolicy.Grades]);
        Assert.DoesNotContain(StudentRecordDataPolicy.HealthNotes, fields.Keys);
        Assert.DoesNotContain(fixture.Record.HealthNotes!, JsonSerializer.Serialize(result.Value));
    }

    [Fact]
    public async Task SchoolAdminCanAccessOnlyPolicyPermittedFieldsInsideScope()
    {
        var fixture = new Fixture(new StudentRecordSchoolAccessContext(
            SchoolRole.SchoolAdmin,
            HasSchoolAdminScope: true));

        var result = await fixture.Service.GetRestrictedAsync(
            fixture.Record.Id,
            new StudentRecordRestrictedRequest([StudentRecordDataPolicy.HealthNotes, "internalSensitiveNotes"]));

        Assert.True(result.IsSuccess);
        Assert.Equal(fixture.Record.HealthNotes, result.Value!.RestrictedFields[StudentRecordDataPolicy.HealthNotes]);
        Assert.DoesNotContain("internalSensitiveNotes", result.Value.RestrictedFields.Keys);
        Assert.DoesNotContain(fixture.Record.InternalSensitiveNotes!, JsonSerializer.Serialize(result.Value));
    }

    private static StudentRecordRestrictedRequest RestrictedRequest()
    {
        return new StudentRecordRestrictedRequest(
            [
                StudentRecordDataPolicy.HealthNotes,
                StudentRecordDataPolicy.GuardianContact,
                StudentRecordDataPolicy.Grades,
                StudentRecordDataPolicy.AttendanceStatus
            ]);
    }

    private sealed class Fixture
    {
        public Fixture(StudentRecordSchoolAccessContext? context)
        {
            Record.TenantId = TenantId;
            Record.WorkspaceId = WorkspaceId;
            CurrentUser = new FakeCurrentUser(UserId);
            CurrentTenant = new FakeCurrentTenant(TenantId);
            StudentRecords = new FakeStudentRecordRepository(Record);
            Workspaces = new FakeWorkspaceRepository(WorkspaceId, UserId, WorkspaceRole.Admin);
            SchoolAccess = new FakeStudentRecordSchoolAccessContextProvider(context);
            Audit = new FakeAuditLogger();
            Service = new StudentRecordService(
                StudentRecords,
                new StudentRecordAuthorizationService(Workspaces, SchoolAccess),
                CurrentUser,
                CurrentTenant,
                Audit);
        }

        public Guid TenantId { get; } = Guid.NewGuid();
        public Guid WorkspaceId { get; } = Guid.NewGuid();
        public Guid UserId { get; } = Guid.NewGuid();

        public StudentRecord Record { get; } = new()
        {
            TenantId = Guid.NewGuid(),
            WorkspaceId = Guid.NewGuid(),
            PublicDisplayName = "Public Student",
            HomeroomLabel = "Class 2-A",
            HealthNotes = "peanut allergy requires epipen",
            GuardianContact = "guardian +1-555-0101",
            Grades = "math A, science B",
            AttendanceStatus = AttendanceStatus.NotAttending,
            InternalSensitiveNotes = "counseling plan is private"
        };

        public FakeCurrentUser CurrentUser { get; }
        public FakeCurrentTenant CurrentTenant { get; }
        public FakeStudentRecordRepository StudentRecords { get; }
        public FakeWorkspaceRepository Workspaces { get; }
        public FakeStudentRecordSchoolAccessContextProvider SchoolAccess { get; }
        public FakeAuditLogger Audit { get; }
        public StudentRecordService Service { get; }
    }

    private sealed class FakeStudentRecordSchoolAccessContextProvider(StudentRecordSchoolAccessContext? context) : IStudentRecordSchoolAccessContextProvider
    {
        public Task<StudentRecordSchoolAccessContext?> GetAccessContextAsync(
            Guid userId,
            StudentRecord record,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(context);
        }
    }

    private sealed class FakeStudentRecordRepository(StudentRecord record) : IStudentRecordRepository
    {
        public Task<StudentRecord?> GetByIdAsync(Guid studentRecordId, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(studentRecordId == record.Id ? record : null);
        }

        public Task AddAsync(StudentRecord studentRecord, CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class FakeWorkspaceRepository(Guid workspaceId, Guid userId, WorkspaceRole role) : IWorkspaceRepository
    {
        public Task<IReadOnlyList<Workspace>> ListForUserAsync(Guid userId, bool includeAll, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<IReadOnlyList<Workspace>>([]);
        }

        public Task<Workspace?> GetByIdAsync(Guid workspaceId, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<Workspace?>(null);
        }

        public Task<WorkspaceMember?> GetMemberAsync(Guid requestedWorkspaceId, Guid requestedUserId, CancellationToken cancellationToken = default)
        {
            if (requestedWorkspaceId != workspaceId || requestedUserId != userId)
            {
                return Task.FromResult<WorkspaceMember?>(null);
            }

            return Task.FromResult<WorkspaceMember?>(new WorkspaceMember
            {
                WorkspaceId = workspaceId,
                UserId = userId,
                Role = role,
                Status = MembershipStatus.Active
            });
        }

        public Task<IReadOnlyList<WorkspaceMember>> ListMembersAsync(Guid workspaceId, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<IReadOnlyList<WorkspaceMember>>([]);
        }

        public Task AddAsync(Workspace workspace, CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }

        public Task AddMemberAsync(WorkspaceMember member, CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class FakeCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId => userId;
        public Guid? SessionId => Guid.NewGuid();
        public string? Email => "student-record-reader@example.test";
        public SystemRole? SystemRole => global::AipPortal.Domain.Enums.SystemRole.Admin;
        public bool IsAuthenticated => true;
    }

    private sealed class FakeCurrentTenant(Guid tenantId) : ICurrentTenant
    {
        public Guid TenantId => tenantId;
        public bool IsAvailable => true;
        public string? TenantSlug => "tenant-a";
        public bool IsPlatformScope => false;
    }

    private sealed class FakeAuditLogger : IAuditLogger
    {
        public List<AuditLogEntry> Entries { get; } = [];

        public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default)
        {
            Entries.Add(entry);
            return Task.CompletedTask;
        }
    }
}
