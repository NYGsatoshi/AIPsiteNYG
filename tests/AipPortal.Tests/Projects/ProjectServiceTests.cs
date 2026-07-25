using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Groups;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
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

        var result = await fixture.Service.ListTasksAsync(fixture.Project.Id, new TaskListQuery());

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
    public async Task ProjectParticipantCanCreateAndUpdateTaskFields()
    {
        var fixture = ProjectFixture.Create();
        var contributor = fixture.AddUser();
        fixture.Current.UserIdValue = contributor.Id;
        fixture.AddProjectMember(contributor.Id, ProjectRole.Contributor);
        var milestone = fixture.AddMilestone("Build", 1);
        var start = new DateOnly(2026, 6, 10);
        var due = new DateOnly(2026, 6, 30);

        var created = await fixture.Service.CreateTaskAsync(fixture.Project.Id, new CreateTaskItemRequest(milestone.Id, "Prep assets", "Collect references", TaskPriority.High, start, due));

        Assert.True(created.IsSuccess);
        Assert.Equal(milestone.Id, created.Value!.MilestoneId);
        Assert.Equal(TaskPriority.High, created.Value.Priority);
        Assert.Equal(TaskItemStatus.NotStarted, created.Value.Status);
        Assert.Equal(0, created.Value.ProgressPercent);

        var membership = fixture.Projects.Members.Single(member => member.ProjectId == fixture.Project.Id && member.UserId == contributor.Id);
        membership.Role = ProjectRole.Manager;
        var updated = await fixture.Service.UpdateTaskAsync(created.Value.Id, new UpdateTaskItemRequest(null, null, null, TaskItemStatus.InProgress, TaskPriority.Critical, null, null, 35));

        Assert.True(updated.IsSuccess);
        Assert.Equal(TaskItemStatus.InProgress, updated.Value!.Status);
        Assert.Equal(TaskPriority.Critical, updated.Value.Priority);
        Assert.Equal(35, updated.Value.ProgressPercent);
    }

    [Fact]
    public async Task TaskResponseProjectsMutationPermissionsAndRejectsUnauthorizedUpdate()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        var viewer = fixture.AddUser();
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);
        fixture.AddProjectMember(viewer.Id, ProjectRole.Viewer);
        var task = fixture.AddTask("Permissioned task");

        fixture.Current.UserIdValue = manager.Id;
        var managerDetail = await fixture.Service.GetTaskAsync(task.Id);

        Assert.True(managerDetail.IsSuccess);
        Assert.True(managerDetail.Value!.UiPermissions.CanEdit);
        Assert.True(managerDetail.Value.UiPermissions.CanAssign);
        Assert.True(managerDetail.Value.UiPermissions.CanDelete);
        Assert.False(managerDetail.Value.UiPermissions.CanChangeStatus);
        Assert.Empty(managerDetail.Value.UiPermissions.AllowedTransitions);

        fixture.Current.UserIdValue = viewer.Id;
        var viewerDetail = await fixture.Service.GetTaskAsync(task.Id);
        var visibleProjects = await fixture.Service.ListAsync(new ProjectListQuery());
        var denied = await fixture.Service.UpdateTaskAsync(task.Id, new UpdateTaskItemRequest(null, "Rejected", null, null, null, null, null, null));

        Assert.True(viewerDetail.IsSuccess);
        Assert.False(viewerDetail.Value!.UiPermissions.CanEdit);
        Assert.True(visibleProjects.Value!.Items.Single().UiPermissions.CanCreateTask);
        Assert.False(denied.IsSuccess);
        Assert.Equal("You are not allowed to update this task.", denied.Error);
        Assert.Equal("Permissioned task", task.Title);
    }

    [Fact]
    public async Task TaskListSupportsPagingSearchAndFilters()
    {
        var fixture = ProjectFixture.Create();
        var viewer = fixture.AddUser();
        fixture.Current.UserIdValue = viewer.Id;
        fixture.AddProjectMember(viewer.Id, ProjectRole.Viewer);
        var milestone = fixture.AddMilestone("Delivery", 1);
        fixture.AddTask("Draft brief").Status = TaskItemStatus.Blocked;
        var target = fixture.AddTask("Review cut");
        target.MilestoneId = milestone.Id;
        target.Status = TaskItemStatus.WaitingReview;
        target.Priority = TaskPriority.Critical;

        var result = await fixture.Service.ListTasksAsync(fixture.Project.Id, new TaskListQuery(Search: "review", Status: TaskItemStatus.WaitingReview, Priority: TaskPriority.Critical, MilestoneId: milestone.Id, Page: 1, PageSize: 1));

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value!.TotalCount);
        Assert.Equal(target.Id, Assert.Single(result.Value.Items).Id);
    }

    [Fact]
    public async Task AssignmentUpdateRejectsDuplicateRoleAndAuditsChanges()
    {
        var fixture = ProjectFixture.Create();
        var manager = fixture.AddUser();
        var assignee = fixture.AddUser();
        fixture.Current.UserIdValue = manager.Id;
        fixture.AddProjectMember(manager.Id, ProjectRole.Manager);
        fixture.AddProjectMember(assignee.Id, ProjectRole.Contributor);
        var task = fixture.AddTask("Composite");
        var owner = await fixture.Service.AddAssignmentAsync(task.Id, new AddTaskAssignmentRequest(assignee.Id, TaskAssignmentRole.Owner, 4));
        var reviewer = await fixture.Service.AddAssignmentAsync(task.Id, new AddTaskAssignmentRequest(assignee.Id, TaskAssignmentRole.Reviewer, 2));

        var duplicate = await fixture.Service.UpdateAssignmentAsync(reviewer.Value!.Id, new UpdateTaskAssignmentRequest(TaskAssignmentRole.Owner, 3, 1));
        var updated = await fixture.Service.UpdateAssignmentAsync(owner.Value!.Id, new UpdateTaskAssignmentRequest(TaskAssignmentRole.Assignee, 3, 1));

        Assert.False(duplicate.IsSuccess);
        Assert.True(updated.IsSuccess);
        Assert.Equal(TaskAssignmentRole.Assignee, updated.Value!.Role);
        Assert.Equal(3, updated.Value.EstimatedHours);
        Assert.Equal(1, updated.Value.ActualHours);
        Assert.Contains(fixture.Audit.Entries, entry => entry.Action == "TaskAssignmentUpdated" && entry.EntityId == task.Id);
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

    [Fact]
    public async Task ProjectListAndCanonicalTaskDetailAgreeForParentDerivedValues()
    {
        var fixture = ProjectFixture.Create();
        var actor = fixture.AddUser();
        fixture.Current.UserIdValue = actor.Id;
        fixture.AddProjectMember(actor.Id, ProjectRole.Manager);
        var parent = fixture.AddTask("parent");
        parent.WorkspaceId = fixture.Workspace.Id;
        parent.TenantId = Guid.NewGuid();
        parent.VersionNo = 7;
        var active = fixture.AddTask("active");
        active.ParentTaskItemId = parent.Id;
        active.WorkspaceId = parent.WorkspaceId;
        active.TenantId = parent.TenantId;
        active.PlannedStartDate = new DateOnly(2026, 7, 2);
        active.PlannedEndDate = new DateOnly(2026, 7, 4);
        active.ProgressPercent = 20;
        var cancelled = fixture.AddTask("cancelled");
        cancelled.ParentTaskItemId = parent.Id;
        cancelled.WorkspaceId = parent.WorkspaceId;
        cancelled.TenantId = parent.TenantId;
        cancelled.PlannedStartDate = new DateOnly(2026, 7, 1);
        cancelled.PlannedEndDate = new DateOnly(2026, 7, 8);
        cancelled.ProgressPercent = 100;
        cancelled.Status = TaskItemStatus.Cancelled;

        var listed = await fixture.Service.ListTasksAsync(fixture.Project.Id, new TaskListQuery());
        var detail = await fixture.Commands.GetAsync(parent.Id);

        Assert.True(listed.IsSuccess);
        Assert.True(detail.IsSuccess);
        var row = Assert.Single(listed.Value!.Items, item => item.Id == parent.Id);
        var canonical = detail.Value!;
        Assert.Equal(row.PlannedStartDate, canonical.PlannedStartDate);
        Assert.Equal(row.PlannedEndDate, canonical.PlannedEndDate);
        Assert.Equal(row.ProgressPercent, canonical.ProgressPercent);
        Assert.Equal(row.ProgressIsDerived, canonical.ProgressIsDerived);
        Assert.Equal(row.IsOverdue, canonical.IsOverdue);
        Assert.Equal(row.Version, canonical.Version);
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
                new NoopInvalidations(),
                new NoopAuthorizationChanges(),
                UnitOfWork);
            Commands = new TaskCommandService(
                Projects,
                Groups,
                Users,
                ProjectAuthorization,
                ProjectAuthorization,
                Current,
                Clock,
                Audit,
                new NoopInvalidations(),
                new NoopTaskCommandUnitOfWork(),
                new UtcTimeZoneResolver());
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
        public TaskCommandService Commands { get; }
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

    private sealed class NoopInvalidations : IBusinessInvalidationPublisher
    {
        public Task TaskChangedAsync(TaskItem task, Guid actorUserId, string change, IEnumerable<string>? changedFields = null, IEnumerable<Guid>? affectedUserIds = null, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task ProjectChangedAsync(Project project, Guid actorUserId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AnnouncementChangedAsync(Announcement announcement, Guid actorUserId, string change, IEnumerable<Guid> audienceUserIds, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task FileChangedAsync(FileObject fileObject, Attachment attachment, Guid actorUserId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class NoopAuthorizationChanges : IAuthorizationStateChangePublisher
    {
        public Task PublishAsync(Guid tenantId, Guid affectedUserId, string scopeType, Guid? scopeId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class NoopTaskCommandUnitOfWork : ITaskCommandUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(1);
        public Task<TaskCommandSaveResult> SaveTaskCommandAsync(CancellationToken cancellationToken = default) => Task.FromResult(TaskCommandSaveResult.Saved);
    }

    private sealed class UtcTimeZoneResolver : ITaskWorkspaceTimeZoneResolver
    {
        public Task<TimeZoneInfo> ResolveAsync(Guid tenantId, Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult(TimeZoneInfo.Utc);
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
        public Task<TaskAssignment?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default)
        {
            var assignment = Assignments.FirstOrDefault(assignment => assignment.Id == assignmentId);
            if (assignment is not null && Tasks.TryGetValue(assignment.TaskItemId, out var task))
            {
                assignment.TaskItem = task;
            }
            return Task.FromResult(assignment);
        }
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
