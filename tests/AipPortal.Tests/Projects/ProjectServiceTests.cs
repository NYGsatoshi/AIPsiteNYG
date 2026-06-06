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

        var result = await fixture.Service.ListTasksAsync(fixture.Project.Id);

        Assert.True(result.IsSuccess);
        Assert.Single(result.Value!);
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

    private sealed class ProjectFixture
    {
        private ProjectFixture()
        {
            WorkspaceAuthorization = new WorkspaceAuthorizationService(Users, Workspaces);
            GroupAuthorization = new GroupAuthorizationService(Groups, Workspaces, WorkspaceAuthorization);
            ProjectAuthorization = new ProjectAuthorizationService(Projects, WorkspaceAuthorization, GroupAuthorization);
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

        public User AddUser(bool addWorkspaceMember = true)
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
                    Role = WorkspaceRole.Member,
                    Status = MembershipStatus.Active,
                    JoinedAt = Clock.UtcNow
                });
            }

            return user;
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
        public Task<IReadOnlyList<Milestone>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Milestone>>(Milestones.Values.Where(milestone => milestone.ProjectId == projectId).ToList());
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
    private sealed class FakeAuditLogger : IAuditLogger { public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default) => Task.CompletedTask; }
    private sealed class FakeNotifications : INotificationService { public Task NotifyAsync(Guid recipientUserId, string title, string? body, string sourceType, Guid sourceId, CancellationToken cancellationToken = default) => Task.CompletedTask; }
    private sealed class FakeUnitOfWork : IUnitOfWork { public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(1); }
}
