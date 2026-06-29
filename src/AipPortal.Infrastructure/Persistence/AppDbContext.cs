using AipPortal.Domain.Common;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace AipPortal.Infrastructure.Persistence;

public sealed class AppDbContext(
    DbContextOptions<AppDbContext> options,
    ICurrentTenant currentTenant) : DbContext(options)
{
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<TenantSettings> TenantSettings => Set<TenantSettings>();
    public DbSet<Plan> Plans => Set<Plan>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<UsageRecord> UsageRecords => Set<UsageRecord>();
    public DbSet<ExportJob> ExportJobs => Set<ExportJob>();
    public DbSet<IntegrationAccount> IntegrationAccounts => Set<IntegrationAccount>();
    public DbSet<WebhookEndpoint> WebhookEndpoints => Set<WebhookEndpoint>();
    public DbSet<ApiToken> ApiTokens => Set<ApiToken>();
    public DbSet<TenantUser> TenantUsers => Set<TenantUser>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Invite> Invites => Set<Invite>();
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<GroupMember> GroupMembers => Set<GroupMember>();
    public DbSet<Channel> Channels => Set<Channel>();
    public DbSet<ChannelMember> ChannelMembers => Set<ChannelMember>();
    public DbSet<Post> Posts => Set<Post>();
    public DbSet<PostThread> PostThreads => Set<PostThread>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMember> ConversationMembers => Set<ConversationMember>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageAttachment> MessageAttachments => Set<MessageAttachment>();
    public DbSet<ReadState> ReadStates => Set<ReadState>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Announcement> Announcements => Set<Announcement>();
    public DbSet<AnnouncementRead> AnnouncementReads => Set<AnnouncementRead>();
    public DbSet<ActivityEvent> ActivityEvents => Set<ActivityEvent>();
    public DbSet<EventAttendance> EventAttendances => Set<EventAttendance>();
    public DbSet<StudentRecord> StudentRecords => Set<StudentRecord>();
    public DbSet<InternalForm> InternalForms => Set<InternalForm>();
    public DbSet<FormQuestion> FormQuestions => Set<FormQuestion>();
    public DbSet<FormResponse> FormResponses => Set<FormResponse>();
    public DbSet<FormAnswer> FormAnswers => Set<FormAnswer>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();
    public DbSet<Milestone> Milestones => Set<Milestone>();
    public DbSet<TaskItem> TaskItems => Set<TaskItem>();
    public DbSet<TaskDependency> TaskDependencies => Set<TaskDependency>();
    public DbSet<TaskAssignment> TaskAssignments => Set<TaskAssignment>();
    public DbSet<ActivityLog> ActivityLogs => Set<ActivityLog>();
    public DbSet<Artifact> Artifacts => Set<Artifact>();
    public DbSet<ArtifactVersion> ArtifactVersions => Set<ArtifactVersion>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<Feedback> Feedback => Set<Feedback>();
    public DbSet<FileObject> FileObjects => Set<FileObject>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<FileScanResult> FileScanResults => Set<FileScanResult>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<SecurityEvent> SecurityEvents => Set<SecurityEvent>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<FeatureModule> FeatureModules => Set<FeatureModule>();
    public DbSet<PanelDefinition> PanelDefinitions => Set<PanelDefinition>();
    public DbSet<UserLayout> UserLayouts => Set<UserLayout>();
    public DbSet<CommandDefinition> CommandDefinitions => Set<CommandDefinition>();
    public DbSet<RadialMenuProfile> RadialMenuProfiles => Set<RadialMenuProfile>();
    public DbSet<RadialMenuItem> RadialMenuItems => Set<RadialMenuItem>();

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        StampAuditableEntities();
        var hasNormalTenantWrite = ApplyTenantRules();
        if (hasNormalTenantWrite)
        {
            await EnsureCurrentTenantCanWriteAsync(cancellationToken);
        }

        return await base.SaveChangesAsync(cancellationToken);
    }

    public override int SaveChanges()
    {
        StampAuditableEntities();
        var hasNormalTenantWrite = ApplyTenantRules();
        if (hasNormalTenantWrite)
        {
            EnsureCurrentTenantCanWrite();
        }

        return base.SaveChanges();
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        ApplyTenantEntityConfiguration(modelBuilder);
        base.OnModelCreating(modelBuilder);
    }

    private void StampAuditableEntities()
    {
        var now = DateTimeOffset.UtcNow;

        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreatedAt = now;
            }

            if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdatedAt = now;
            }
        }
    }

    private bool ApplyTenantRules()
    {
        var hasNormalTenantWrite = false;

        foreach (var entry in ChangeTracker.Entries<ITenantEntity>())
        {
            if (entry.State is EntityState.Detached or EntityState.Unchanged)
            {
                continue;
            }

            if (currentTenant.IsPlatformScope)
            {
                if (entry.State == EntityState.Added && entry.Entity.TenantId == Guid.Empty)
                {
                    throw new InvalidOperationException("Platform-scope tenant entities must set TenantId explicitly.");
                }

                continue;
            }

            hasNormalTenantWrite = true;

            if (!currentTenant.IsAvailable)
            {
                throw new InvalidOperationException("A tenant scope is required to save tenant-owned data.");
            }

            if (entry.State == EntityState.Added && entry.Entity.TenantId == Guid.Empty)
            {
                entry.Entity.TenantId = currentTenant.TenantId;
                continue;
            }

            if (entry.Entity.TenantId != currentTenant.TenantId)
            {
                throw new InvalidOperationException("TenantId does not match the current tenant context.");
            }
        }

        return hasNormalTenantWrite;
    }

    private async Task EnsureCurrentTenantCanWriteAsync(CancellationToken cancellationToken)
    {
        var isActive = await Tenants
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == currentTenant.TenantId && tenant.Status == TenantStatus.Active, cancellationToken);

        if (!isActive)
        {
            throw new InvalidOperationException("Current tenant is not active and cannot save tenant-owned data.");
        }
    }

    private void EnsureCurrentTenantCanWrite()
    {
        var isActive = Tenants
            .AsNoTracking()
            .Any(tenant => tenant.Id == currentTenant.TenantId && tenant.Status == TenantStatus.Active);

        if (!isActive)
        {
            throw new InvalidOperationException("Current tenant is not active and cannot save tenant-owned data.");
        }
    }

    private void ApplyTenantEntityConfiguration(ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes()
            .Where(entityType => typeof(ITenantEntity).IsAssignableFrom(entityType.ClrType)))
        {
            ConfigureTenantEntity(modelBuilder, entityType);
        }
    }

    private void ConfigureTenantEntity(ModelBuilder modelBuilder, IMutableEntityType entityType)
    {
        var builder = modelBuilder.Entity(entityType.ClrType);
        builder.Property<Guid>(nameof(ITenantEntity.TenantId)).IsRequired();
        builder.HasIndex(nameof(ITenantEntity.TenantId));

        var method = typeof(AppDbContext)
            .GetMethod(nameof(ApplyTenantQueryFilter), System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .MakeGenericMethod(entityType.ClrType);
        method.Invoke(this, new object[] { modelBuilder });
    }

    private void ApplyTenantQueryFilter<TEntity>(ModelBuilder modelBuilder)
        where TEntity : class, ITenantEntity
    {
        modelBuilder.Entity<TEntity>().HasQueryFilter(entity =>
            currentTenant.IsPlatformScope ||
            (currentTenant.IsAvailable && entity.TenantId == currentTenant.TenantId));
    }
}
