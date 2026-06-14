using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Groups;
using AipPortal.Application.Projects;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Tests.Projects;

public sealed class ProjectServiceTests
{
    [Fact]
    public async Task NonMemberCannotViewProject()
    {
        var fixture = ProjectFixture.Create();

        var canView = await fixture.ProjectAuthorization.CanViewProject(Guid.NewGuid(), fixture.Project.Id);

        Assert.False(canView);
    }

    [Fact]
    public async Task ProjectMemberCanViewTasks()
    {
        var fixture = ProjectFixture.Create();
        var member = fixture.AddUser();
        fixture.Current.UserIdValue = member.Id;
        fixture.AddProjectMember(member.Id, ProjectRole.Viewer);
        fixture.AddTask("Storyboard");

        var result = await fixture.Service.ListTasksAsync(fixture.Project.Id, new ProjectChildListQuery());

        Assert.True(result.IsSuccess);
        Assert.Single(result.Value!.Items);
    }

    [Fact]
    public async Task UserOutsideProjectCannotBeAssigned()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        var outsider = fixture.AddUser(addWorkspaceMember: false);
        fixture.Current.UserIdValue = manager.Id;
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);
        var task = fixture.AddTask("Layout");

        var result = await fixture.Service.AddAssignmentAsync(task.Id, new AddTaskAssignmentRequest(outsider.Id, TaskAssignmentRole.Assignee, 2));

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task TaskCannotDependOnItself()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        fixture.Current.UserIdValue = manager.Id;
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);
        var task = fixture.AddTask("Blocking");

        var result = await fixture.Service.AddDependencyAsync(task.Id, new AddTaskDependencyRequest(task.Id, TaskDependencyType.FinishToStart));

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task DuplicateDependencyIsRejected()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        fixture.Current.UserIdValue = manager.Id;
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);
        var predecessor = fixture.AddTask("Concept");
        var successor = fixture.AddTask("Final");
        fixture.Dependencies.Add(new TaskDependency
        {
            ProjectId = fixture.Project.Id,
            PredecessorTaskItemId = predecessor.Id,
            SuccessorTaskItemId = successor.Id
        });

        var result = await fixture.Service.AddDependencyAsync(successor.Id, new AddTaskDependencyRequest(predecessor.Id, TaskDependencyType.FinishToStart));

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task CommentTargetAuthorizationWorks()
    {
        var fixture = ProjectFixture.Create();
        var outsider = fixture.AddUser(addWorkspaceMember: false);
        fixture.Current.UserIdValue = outsider.Id;

        var result = await fixture.Service.AddCommentAsync(new CreateCommentRequest(CommentTargetType.Project, fixture.Project.Id, "Looks good"));

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task SoftDeletedProjectIsHiddenFromNormalList()
    {
        var fixture = ProjectFixture.Create();
        var member = fixture.AddUser();
        fixture.Current.UserIdValue = member.Id;
        fixture.AddProjectMember(member.Id, ProjectRole.Viewer);
        fixture.Project.MarkDeleted(fixture.Clock.UtcNow, member.Id, "test");

        var result = await fixture.Service.ListAsync(new ProjectListQuery());

        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value!.Items);
    }

    [Fact]
    public async Task ArchivedProjectIsVisibleOnlyWithArchiveFilter()
    {
        var fixture = ProjectFixture.Create();
        var member = fixture.AddUser();
        fixture.Current.UserIdValue = member.Id;
        fixture.AddProjectMember(member.Id, ProjectRole.Viewer);
        fixture.Project.Status = ProjectStatus.Archived;

        var normal = await fixture.Service.ListAsync(new ProjectListQuery());
        var archived = await fixture.Service.ListAsync(new ProjectListQuery(Archived: true));

        Assert.True(normal.IsSuccess);
        Assert.Empty(normal.Value!.Items);
        Assert.True(archived.IsSuccess);
        Assert.Single(archived.Value!.Items);
    }

    [Fact]
    public async Task ProjectListSupportsPagingAndSearch()
    {
        var fixture = ProjectFixture.Create();
        var member = fixture.AddUser();
        fixture.Current.UserIdValue = member.Id;
        fixture.AddProjectMember(member.Id, ProjectRole.Viewer);
        var secondProject = new Project
        {
            WorkspaceId = fixture.Workspace.Id,
            OwnerUserId = member.Id,
            CreatedByUserId = member.Id,
            Name = "Marketing Launch",
            Slug = "marketing-launch",
            Description = "Campaign timeline",
            Status = ProjectStatus.Active
        };
        fixture.Projects.ProjectItems[secondProject.Id] = secondProject;
        fixture.Projects.Members.Add(new ProjectMember { ProjectId = secondProject.Id, UserId = member.Id, User = member, Role = ProjectRole.Viewer, JoinedAt = fixture.Clock.UtcNow });

        var result = await fixture.Service.ListAsync(new ProjectListQuery(Search: "marketing", Page: 1, PageSize: 1));

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value!.Page);
        Assert.Equal(1, result.Value.PageSize);
        Assert.Equal(1, result.Value.TotalCount);
        Assert.Equal(secondProject.Id, Assert.Single(result.Value.Items).Id);
    }


    [Fact]
    public async Task CreateRequiresGroup()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser(workspaceRole: WorkspaceRole.Admin);
        fixture.Current.UserIdValue = manager.Id;

        var result = await fixture.Service.CreateAsync(new CreateProjectRequest(fixture.Workspace.Id, Guid.Empty, "New Project", null, null, null));

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task AuthorizedGroupManagerCanCreateProjectWithDates()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        var group = fixture.AddGroup(manager.Id, GroupRole.Admin);
        fixture.Current.UserIdValue = manager.Id;
        var start = new DateOnly(2026, 6, 1);
        var expectedEnd = new DateOnly(2026, 7, 1);

        var result = await fixture.Service.CreateAsync(new CreateProjectRequest(fixture.Workspace.Id, group.Id, "New Project", "Scoped", start, expectedEnd));

        Assert.True(result.IsSuccess);
        Assert.Equal(group.Id, result.Value!.GroupId);
        Assert.Equal(start, result.Value.StartDate);
        Assert.Equal(expectedEnd, result.Value.EndDate);
        Assert.Contains(fixture.Projects.Members, member => member.ProjectId == result.Value.Id && member.UserId == manager.Id && member.Role == ProjectRole.Owner);
    }

    [Fact]
    public async Task InvalidStatusTransitionIsRejected()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        fixture.Current.UserIdValue = manager.Id;
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);
        fixture.Project.Status = ProjectStatus.Completed;

        var result = await fixture.Service.UpdateAsync(fixture.Project.Id, new UpdateProjectRequest(null, null, ProjectStatus.Active, null, null));

        Assert.False(result.IsSuccess);
        Assert.Equal(ProjectStatus.Completed, fixture.Project.Status);
    }

    [Fact]
    public async Task ArchiveCreatesAuditLog()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        fixture.Current.UserIdValue = manager.Id;
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);

        var result = await fixture.Service.ArchiveAsync(fixture.Project.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal(ProjectStatus.Archived, fixture.Project.Status);
        Assert.False(fixture.Project.DeletedAt.HasValue);
        Assert.Contains(fixture.Audit.Entries, entry => entry.Action == "ProjectArchived" && entry.EntityId == fixture.Project.Id);
    }

    [Fact]
    public async Task ProjectManagerCanCreateAndUpdateMilestoneFields()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        fixture.Current.UserIdValue = manager.Id;
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);
        var dueDate = new DateOnly(2026, 7, 15);

        var created = await fixture.Service.CreateMilestoneAsync(fixture.Project.Id, new CreateMilestoneRequest("Alpha", "Scope", dueDate, 20));

        Assert.True(created.IsSuccess);
        Assert.Equal(fixture.Project.Id, created.Value!.ProjectId);
        Assert.Equal(dueDate, created.Value.DueDate);
        Assert.Equal(MilestoneStatus.NotStarted, created.Value.Status);
        Assert.Equal(20, created.Value.DisplayOrder);

        var updated = await fixture.Service.UpdateMilestoneAsync(created.Value.Id, new UpdateMilestoneRequest(null, "Updated", new DateOnly(2026, 8, 1), MilestoneStatus.InProgress, 10));

        Assert.True(updated.IsSuccess);
        Assert.Equal("Updated", updated.Value!.Description);
        Assert.Equal(new DateOnly(2026, 8, 1), updated.Value.DueDate);
        Assert.Equal(MilestoneStatus.InProgress, updated.Value.Status);
        Assert.Equal(10, updated.Value.DisplayOrder);
    }

    [Fact]
    public async Task MilestoneListPreservesDisplayOrder()
    {
        var fixture = ProjectFixture.Create();
        var viewer = fixture.AddUser();
        fixture.Current.UserIdValue = viewer.Id;
        fixture.AddProjectMember(viewer.Id, ProjectRole.Viewer);
        fixture.AddMilestone("Second", 20);
        fixture.AddMilestone("First", 10);

        var result = await fixture.Service.ListMilestonesAsync(fixture.Project.Id, new ProjectChildListQuery());

        Assert.True(result.IsSuccess);
        Assert.Collection(result.Value!.Items,
            milestone => Assert.Equal("First", milestone.Title),
            milestone => Assert.Equal("Second", milestone.Title));
    }

    [Fact]
    public async Task UnauthorizedUserCannotCreateOrViewMilestones()
    {
        var fixture = ProjectFixture.Create();
        var outsider = fixture.AddUser(addWorkspaceMember: false);
        fixture.Current.UserIdValue = outsider.Id;
        var milestone = fixture.AddMilestone("Restricted", 1);

        var list = await fixture.Service.ListMilestonesAsync(fixture.Project.Id, new ProjectChildListQuery());
        var get = await fixture.Service.GetMilestoneAsync(milestone.Id);
        var create = await fixture.Service.CreateMilestoneAsync(fixture.Project.Id, new CreateMilestoneRequest("Blocked", null, null, 2));

        Assert.False(list.IsSuccess);
        Assert.False(get.IsSuccess);
        Assert.False(create.IsSuccess);
    }

    [Fact]
    public async Task UnsupportedMilestoneStatusIsRejected()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        fixture.Current.UserIdValue = manager.Id;
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);
        var milestone = fixture.AddMilestone("Alpha", 1);

        var result = await fixture.Service.UpdateMilestoneAsync(milestone.Id, new UpdateMilestoneRequest(null, null, null, MilestoneStatus.Cancelled, null));

        Assert.False(result.IsSuccess);
        Assert.Equal(MilestoneStatus.NotStarted, milestone.Status);
    }

    private sealed class ProjectFixture
    {
        private ProjectFixture()
        {
            WorkspaceAuthorization = new WorkspaceAuthorizationService(Users, Workspaces);
            GroupAuthorization = new GroupAuthorizationService(Groups, Workspaces, WorkspaceAuthorization);
            ProjectAuthorization = new ProjectAuthorizationService(Projects, WorkspaceAuthorization, GroupAuthorization, Groups);
            Service = new ProjectService(
                Projects,
                Workspaces,
                Groups,
                Users,
                ProjectAuthorization,
                ProjectAuthorization,
                ProjectAuthorization,
                Current,
                Clock,
                Audit,
                Notifications,
                UnitOfWork);
        }

        public FakeUsers Users { get; } = new();
        public FakeWorkspaces Workspaces { get; } = new();
        public FakeGroups Groups { get; } = new();
        public FakeProjects Projects { get; } = new();
        public FakeCurrentUser Current { get; } = new();
        public FakeClock Clock { get; } = new();
        public FakeAuditLogger Audit { get; } = new();
        public FakeNotifications Notifications { get; } = new();
        public FakeUnitOfWork UnitOfWork { get; } = new();
        public WorkspaceAuthorizationService WorkspaceAuthorization { get; }
        public GroupAuthorizationService GroupAuthorization { get; }
        public ProjectAuthorizationService ProjectAuthorization { get; }
        public ProjectService Service { get; }
        public Workspace Workspace { get; } = new() { Name = "Workspace", Slug = "workspace", CreatedByUserId = Guid.NewGuid(), Status = WorkspaceStatus.Active };
        public Project Project { get; } = new() { Name = "Launch", Slug = "launch", WorkspaceId = Guid.Empty, OwnerUserId = Guid.NewGuid(), CreatedByUserId = Guid.NewGuid(), Status = ProjectStatus.Active };
        public List<TaskDependency> Dependencies => Projects.Dependencies;

        public static ProjectFixture Create()
        {
            var fixture = new ProjectFixture();
            fixture.Project.WorkspaceId = fixture.Workspace.Id;
            fixture.Workspaces.Items[fixture.Workspace.Id] = fixture.Workspace;
            fixture.Projects.ProjectItems[fixture.Project.Id] = fixture.Project;
            return fixture;
        }

        public User AddUser(bool addWorkspaceMember = true, WorkspaceRole workspaceRole = WorkspaceRole.Member)
        {
            var user = new User
            {
                DisplayName = $"User {Users.Items.Count + 1}",
                Email = $"user{Users.Items.Count + 1}@example.com",
                NormalizedEmail = $"USER{Users.Items.Count + 1}@EXAMPLE.COM",
                PasswordHash = "hash",
                Status = UserStatus.Active
            };
            Users.Items[user.Id] = user;
            if (addWorkspaceMember)
            {
                Workspaces.Members.Add(new WorkspaceMember
                {
                    WorkspaceId = Workspace.Id,
                    UserId = user.Id,
                    User = user,
                    Role = workspaceRole,
                    Status = MembershipStatus.Active,
                    JoinedAt = Clock.UtcNow
                });
            }

            return user;
        }

        public Group AddGroup(Guid userId, GroupRole role = GroupRole.Member)
        {
            var group = new Group { WorkspaceId = Workspace.Id, Name = "Projects", Slug = "projects", GroupType = GroupType.ProjectGroup, Status = GroupStatus.Active, CreatedByUserId = userId };
            Groups.Items[group.Id] = group;
            Groups.Members.Add(new GroupMember { GroupId = group.Id, UserId = userId, Role = role, JoinedAt = Clock.UtcNow });
            return group;
        }

        public void AddProjectMember(Guid userId, ProjectRole role)
        {
            Projects.Members.Add(new ProjectMember
            {
                ProjectId = Project.Id,
                UserId = userId,
                User = Users.Items[userId],
                Role = role,
                JoinedAt = Clock.UtcNow
            });
        }

        public TaskItem AddTask(string title)
        {
            var task = new TaskItem
            {
                ProjectId = Project.Id,
                Title = title,
                CreatedByUserId = Guid.NewGuid()
            };
            Projects.Tasks[task.Id] = task;
            return task;
        }

        public Milestone AddMilestone(string title, int displayOrder)
        {
            var milestone = new Milestone
            {
                ProjectId = Project.Id,
                Name = title,
                SortOrder = displayOrder
            };
            Projects.Milestones[milestone.Id] = milestone;
            return milestone;
        }
    }

    private sealed class FakeProjects : IProjectRepository
    {
        public Dictionary<Guid, Project> ProjectItems { get; } = [];
        public List<ProjectMember> Members { get; } = [];
        public Dictionary<Guid, Milestone> Milestones { get; } = [];
        public Dictionary<Guid, TaskItem> Tasks { get; } = [];
        public List<TaskAssignment> Assignments { get; } = [];
        public List<TaskDependency> Dependencies { get; } = [];
        public List<Comment> Comments { get; } = [];

        public Task<IReadOnlyList<Project>> ListVisibleAsync(Guid userId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Project>>(ProjectItems.Values.Where(project => Members.Any(member => member.ProjectId == project.Id && member.UserId == userId)).ToList());
        public Task<Project?> GetProjectAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult(ProjectItems.GetValueOrDefault(projectId));
        public Task<ProjectMember?> GetMemberAsync(Guid projectId, Guid userId, CancellationToken cancellationToken = default) => Task.FromResult(Members.FirstOrDefault(member => member.ProjectId == projectId && member.UserId == userId));
        public Task<IReadOnlyList<ProjectMember>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<ProjectMember>>(Members.Where(member => member.ProjectId == projectId).ToList());
        public Task<IReadOnlyList<Milestone>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Milestone>>(Milestones.Values.Where(milestone => milestone.ProjectId == projectId).OrderBy(milestone => milestone.SortOrder).ThenBy(milestone => milestone.DueDate).ToList());
        public Task<Milestone?> GetMilestoneAsync(Guid milestoneId, CancellationToken cancellationToken = default) => Task.FromResult(Milestones.GetValueOrDefault(milestoneId));
        public Task<IReadOnlyList<TaskItem>> ListTasksAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskItem>>(Tasks.Values.Where(task => task.ProjectId == projectId).ToList());
        public Task<TaskItem?> GetTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult(Tasks.GetValueOrDefault(taskItemId));
        public Task<IReadOnlyList<TaskAssignment>> ListAssignmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskAssignment>>(Assignments.Where(assignment => assignment.TaskItemId == taskItemId).ToList());
        public Task<TaskAssignment?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default) => Task.FromResult(Assignments.FirstOrDefault(assignment => assignment.Id == assignmentId));
        public Task<IReadOnlyList<TaskDependency>> ListDependenciesAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskDependency>>(Dependencies.Where(dependency => dependency.PredecessorTaskItemId == taskItemId || dependency.SuccessorTaskItemId == taskItemId).ToList());
        public Task<IReadOnlyList<TaskDependency>> ListProjectDependenciesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskDependency>>(Dependencies.Where(dependency => dependency.ProjectId == projectId).ToList());
        public Task<TaskDependency?> GetDependencyAsync(Guid dependencyId, CancellationToken cancellationToken = default) => Task.FromResult(Dependencies.FirstOrDefault(dependency => dependency.Id == dependencyId));
        public Task<bool> DependencyExistsAsync(Guid predecessorTaskId, Guid successorTaskId, CancellationToken cancellationToken = default) => Task.FromResult(Dependencies.Any(dependency => dependency.PredecessorTaskItemId == predecessorTaskId && dependency.SuccessorTaskItemId == successorTaskId));
        public Task<IReadOnlyList<Comment>> ListCommentsAsync(CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Comment>>(Comments.Where(comment => comment.TargetType == targetType && comment.TargetId == targetId).ToList());
        public Task<Comment?> GetCommentAsync(Guid commentId, CancellationToken cancellationToken = default) => Task.FromResult(Comments.FirstOrDefault(comment => comment.Id == commentId));
        public Task AddProjectAsync(Project project, CancellationToken cancellationToken = default) { ProjectItems[project.Id] = project; return Task.CompletedTask; }
        public Task AddMemberAsync(ProjectMember member, CancellationToken cancellationToken = default) { Members.Add(member); return Task.CompletedTask; }
        public Task AddMilestoneAsync(Milestone milestone, CancellationToken cancellationToken = default) { Milestones[milestone.Id] = milestone; return Task.CompletedTask; }
        public Task AddTaskAsync(TaskItem task, CancellationToken cancellationToken = default) { Tasks[task.Id] = task; return Task.CompletedTask; }
        public Task AddAssignmentAsync(TaskAssignment assignment, CancellationToken cancellationToken = default) { Assignments.Add(assignment); return Task.CompletedTask; }
        public Task AddDependencyAsync(TaskDependency dependency, CancellationToken cancellationToken = default) { Dependencies.Add(dependency); return Task.CompletedTask; }
        public Task AddCommentAsync(Comment comment, CancellationToken cancellationToken = default) { Comments.Add(comment); return Task.CompletedTask; }
        public void RemoveMember(ProjectMember member) => Members.Remove(member);
        public void RemoveAssignment(TaskAssignment assignment) => Assignments.Remove(assignment);
        public void RemoveDependency(TaskDependency dependency) => Dependencies.Remove(dependency);
    }

    private sealed class FakeUsers : IUserRepository
    {
        public Dictionary<Guid, User> Items { get; } = [];
        public Task<User?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(Items.GetValueOrDefault(id));
        public Task<User?> GetByNormalizedEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default) => Task.FromResult(Items.Values.FirstOrDefault(user => user.NormalizedEmail == normalizedEmail));
        public Task AddAsync(User user, CancellationToken cancellationToken = default) { Items[user.Id] = user; return Task.CompletedTask; }
    }

    private sealed class FakeWorkspaces : IWorkspaceRepository
    {
        public Dictionary<Guid, Workspace> Items { get; } = [];
        public List<WorkspaceMember> Members { get; } = [];
        public Task<IReadOnlyList<Workspace>> ListForUserAsync(Guid userId, bool includeAll, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Workspace>>(Items.Values.ToList());
        public Task<Workspace?> GetByIdAsync(Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult(Items.GetValueOrDefault(workspaceId));
        public Task<WorkspaceMember?> GetMemberAsync(Guid workspaceId, Guid userId, CancellationToken cancellationToken = default) => Task.FromResult(Members.FirstOrDefault(member => member.WorkspaceId == workspaceId && member.UserId == userId));
        public Task<IReadOnlyList<WorkspaceMember>> ListMembersAsync(Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<WorkspaceMember>>(Members.Where(member => member.WorkspaceId == workspaceId).ToList());
        public Task AddAsync(Workspace workspace, CancellationToken cancellationToken = default) { Items[workspace.Id] = workspace; return Task.CompletedTask; }
        public Task AddMemberAsync(WorkspaceMember member, CancellationToken cancellationToken = default) { Members.Add(member); return Task.CompletedTask; }
    }

    private sealed class FakeGroups : IGroupRepository
    {
        public Dictionary<Guid, Group> Items { get; } = [];
        public List<GroupMember> Members { get; } = [];
        public Task<IReadOnlyList<Group>> ListByWorkspaceAsync(Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Group>>(Items.Values.Where(group => group.WorkspaceId == workspaceId).ToList());
        public Task<Group?> GetByIdAsync(Guid groupId, CancellationToken cancellationToken = default) => Task.FromResult(Items.GetValueOrDefault(groupId));
        public Task<GroupMember?> GetMemberAsync(Guid groupId, Guid userId, CancellationToken cancellationToken = default) => Task.FromResult(Members.FirstOrDefault(member => member.GroupId == groupId && member.UserId == userId));
        public Task<IReadOnlyList<GroupMember>> ListMembersAsync(Guid groupId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<GroupMember>>(Members.Where(member => member.GroupId == groupId).ToList());
        public Task AddAsync(Group group, CancellationToken cancellationToken = default) { Items[group.Id] = group; return Task.CompletedTask; }
        public Task AddMemberAsync(GroupMember member, CancellationToken cancellationToken = default) { Members.Add(member); return Task.CompletedTask; }
    }

    private sealed class FakeCurrentUser : ICurrentUser
    {
        public Guid? UserIdValue { get; set; }
        public Guid? UserId => UserIdValue;
        public Guid? SessionId => null;
        public string? Email => null;
        public SystemRole? SystemRole => null;
        public bool IsAuthenticated => UserIdValue.HasValue;
    }

    private sealed class FakeClock : IClock { public DateTimeOffset UtcNow { get; } = new(2026, 6, 6, 0, 0, 0, TimeSpan.Zero); }
    private sealed class FakeAuditLogger : IAuditLogger
    {
        public List<AuditLogEntry> Entries { get; } = [];
        public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default)
        {
            Entries.Add(entry);
            return Task.CompletedTask;
        }
    }
    private sealed class FakeNotifications : INotificationService { public Task NotifyAsync(Guid recipientUserId, string title, string? body, string sourceType, Guid sourceId, CancellationToken cancellationToken = default) => Task.CompletedTask; }
    private sealed class FakeUnitOfWork : IUnitOfWork { public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(1); }
}
