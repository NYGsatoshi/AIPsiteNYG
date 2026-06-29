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
        Assert.Null(StudentRecordDataPolicy.Classify("internalSensitiveNotes"));
    }

    [Fact]
    public async Task UnauthorizedCallerCannotReadStudentRecordRestrictedValues()
    {
        var fixture = new Fixture(WorkspaceRole.ReadOnly);

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
        var fixture = new Fixture(WorkspaceRole.Member);

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
        var fixture = new Fixture(WorkspaceRole.Admin);

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
        var fixture = new Fixture(WorkspaceRole.Owner);

        var result = await fixture.Service.GetRestrictedAsync(
            fixture.Record.Id,
            new StudentRecordRestrictedRequest(["internalSensitiveNotes"]));

        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value!.RestrictedFields);
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
        public Fixture(WorkspaceRole callerWorkspaceRole)
        {
            Record.TenantId = TenantId;
            Record.WorkspaceId = WorkspaceId;
            CurrentUser = new FakeCurrentUser(UserId);
            CurrentTenant = new FakeCurrentTenant(TenantId);
            StudentRecords = new FakeStudentRecordRepository(Record);
            Workspaces = new FakeWorkspaceRepository(WorkspaceId, UserId, callerWorkspaceRole);
            Audit = new FakeAuditLogger();
            Service = new StudentRecordService(
                StudentRecords,
                new StudentRecordAuthorizationService(Workspaces),
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
        public FakeAuditLogger Audit { get; }
        public StudentRecordService Service { get; }
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
