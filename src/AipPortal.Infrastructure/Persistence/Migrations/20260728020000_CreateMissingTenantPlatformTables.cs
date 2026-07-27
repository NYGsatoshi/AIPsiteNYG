using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace AipPortal.Infrastructure.Persistence.Migrations;

/// <summary>
/// Repairs historical migration-chain omissions for already-modelled tenant
/// platform tables. A clean database must contain every table represented by
/// the current model before application bootstrap and feature evaluation run.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260728020000_CreateMissingTenantPlatformTables")]
public sealed class CreateMissingTenantPlatformTables : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "api_tokens",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                TokenHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                ScopesJson = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                LastUsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_api_tokens", x => x.Id);
                table.ForeignKey(
                    name: "FK_api_tokens_users_CreatedByUserId",
                    column: x => x.CreatedByUserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "export_jobs",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                Status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                ExportType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                FileObjectId = table.Column<Guid>(type: "uuid", nullable: true),
                CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                ErrorMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_export_jobs", x => x.Id);
                table.ForeignKey(
                    name: "FK_export_jobs_file_objects_FileObjectId",
                    column: x => x.FileObjectId,
                    principalTable: "file_objects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.SetNull);
                table.ForeignKey(
                    name: "FK_export_jobs_users_RequestedByUserId",
                    column: x => x.RequestedByUserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "integration_accounts",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                Provider = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                DisplayName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                Status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                SettingsJson = table.Column<string>(type: "character varying(12000)", maxLength: 12000, nullable: false),
                CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                DeletedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                DeleteReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_integration_accounts", x => x.Id);
                table.ForeignKey(
                    name: "FK_integration_accounts_users_CreatedByUserId",
                    column: x => x.CreatedByUserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "subscriptions",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                PlanId = table.Column<Guid>(type: "uuid", nullable: false),
                Status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                EndsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                TrialEndsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_subscriptions", x => x.Id);
                table.ForeignKey(
                    name: "FK_subscriptions_plans_PlanId",
                    column: x => x.PlanId,
                    principalTable: "plans",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_subscriptions_tenants_TenantId",
                    column: x => x.TenantId,
                    principalTable: "tenants",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "usage_records",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                Date = table.Column<DateOnly>(type: "date", nullable: false),
                ActiveUserCount = table.Column<int>(type: "integer", nullable: false),
                TotalUserCount = table.Column<int>(type: "integer", nullable: false),
                ProjectCount = table.Column<int>(type: "integer", nullable: false),
                TaskCount = table.Column<int>(type: "integer", nullable: false),
                FileCount = table.Column<int>(type: "integer", nullable: false),
                StorageUsedBytes = table.Column<long>(type: "bigint", nullable: false),
                ApiRequestCount = table.Column<int>(type: "integer", nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_usage_records", x => x.Id);
                table.ForeignKey(
                    name: "FK_usage_records_tenants_TenantId",
                    column: x => x.TenantId,
                    principalTable: "tenants",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "webhook_endpoints",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                Url = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                SecretHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                EnabledEventsJson = table.Column<string>(type: "character varying(12000)", maxLength: 12000, nullable: false),
                Status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                DeletedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                DeleteReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_webhook_endpoints", x => x.Id);
                table.ForeignKey(
                    name: "FK_webhook_endpoints_users_CreatedByUserId",
                    column: x => x.CreatedByUserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(name: "IX_api_tokens_CreatedAt", table: "api_tokens", column: "CreatedAt");
        migrationBuilder.CreateIndex(name: "IX_api_tokens_CreatedByUserId", table: "api_tokens", column: "CreatedByUserId");
        migrationBuilder.CreateIndex(name: "IX_api_tokens_ExpiresAt", table: "api_tokens", column: "ExpiresAt");
        migrationBuilder.CreateIndex(name: "IX_api_tokens_RevokedAt", table: "api_tokens", column: "RevokedAt");
        migrationBuilder.CreateIndex(name: "IX_api_tokens_TenantId", table: "api_tokens", column: "TenantId");
        migrationBuilder.CreateIndex(name: "IX_api_tokens_TokenHash", table: "api_tokens", column: "TokenHash", unique: true);
        migrationBuilder.CreateIndex(name: "IX_api_tokens_TenantId_Name", table: "api_tokens", columns: new[] { "TenantId", "Name" });

        migrationBuilder.CreateIndex(name: "IX_export_jobs_CreatedAt", table: "export_jobs", column: "CreatedAt");
        migrationBuilder.CreateIndex(name: "IX_export_jobs_FileObjectId", table: "export_jobs", column: "FileObjectId");
        migrationBuilder.CreateIndex(name: "IX_export_jobs_RequestedByUserId", table: "export_jobs", column: "RequestedByUserId");
        migrationBuilder.CreateIndex(name: "IX_export_jobs_Status", table: "export_jobs", column: "Status");
        migrationBuilder.CreateIndex(name: "IX_export_jobs_TenantId", table: "export_jobs", column: "TenantId");

        migrationBuilder.CreateIndex(name: "IX_integration_accounts_CreatedAt", table: "integration_accounts", column: "CreatedAt");
        migrationBuilder.CreateIndex(name: "IX_integration_accounts_CreatedByUserId", table: "integration_accounts", column: "CreatedByUserId");
        migrationBuilder.CreateIndex(name: "IX_integration_accounts_DeletedAt", table: "integration_accounts", column: "DeletedAt");
        migrationBuilder.CreateIndex(name: "IX_integration_accounts_DeletedByUserId", table: "integration_accounts", column: "DeletedByUserId");
        migrationBuilder.CreateIndex(name: "IX_integration_accounts_Provider", table: "integration_accounts", column: "Provider");
        migrationBuilder.CreateIndex(name: "IX_integration_accounts_Status", table: "integration_accounts", column: "Status");
        migrationBuilder.CreateIndex(name: "IX_integration_accounts_TenantId", table: "integration_accounts", column: "TenantId");
        migrationBuilder.CreateIndex(name: "IX_integration_accounts_TenantId_Provider_DisplayName", table: "integration_accounts", columns: new[] { "TenantId", "Provider", "DisplayName" });

        migrationBuilder.CreateIndex(name: "IX_subscriptions_CreatedAt", table: "subscriptions", column: "CreatedAt");
        migrationBuilder.CreateIndex(name: "IX_subscriptions_PlanId", table: "subscriptions", column: "PlanId");
        migrationBuilder.CreateIndex(name: "IX_subscriptions_TenantId", table: "subscriptions", column: "TenantId");
        migrationBuilder.CreateIndex(name: "IX_subscriptions_TenantId_Status", table: "subscriptions", columns: new[] { "TenantId", "Status" });

        migrationBuilder.CreateIndex(name: "IX_usage_records_TenantId", table: "usage_records", column: "TenantId");
        migrationBuilder.CreateIndex(name: "IX_usage_records_TenantId_Date", table: "usage_records", columns: new[] { "TenantId", "Date" }, unique: true);

        migrationBuilder.CreateIndex(name: "IX_webhook_endpoints_CreatedAt", table: "webhook_endpoints", column: "CreatedAt");
        migrationBuilder.CreateIndex(name: "IX_webhook_endpoints_CreatedByUserId", table: "webhook_endpoints", column: "CreatedByUserId");
        migrationBuilder.CreateIndex(name: "IX_webhook_endpoints_DeletedAt", table: "webhook_endpoints", column: "DeletedAt");
        migrationBuilder.CreateIndex(name: "IX_webhook_endpoints_DeletedByUserId", table: "webhook_endpoints", column: "DeletedByUserId");
        migrationBuilder.CreateIndex(name: "IX_webhook_endpoints_Status", table: "webhook_endpoints", column: "Status");
        migrationBuilder.CreateIndex(name: "IX_webhook_endpoints_TenantId", table: "webhook_endpoints", column: "TenantId");
        migrationBuilder.CreateIndex(name: "IX_webhook_endpoints_TenantId_Name", table: "webhook_endpoints", columns: new[] { "TenantId", "Name" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "api_tokens");
        migrationBuilder.DropTable(name: "export_jobs");
        migrationBuilder.DropTable(name: "integration_accounts");
        migrationBuilder.DropTable(name: "subscriptions");
        migrationBuilder.DropTable(name: "usage_records");
        migrationBuilder.DropTable(name: "webhook_endpoints");
    }
}
