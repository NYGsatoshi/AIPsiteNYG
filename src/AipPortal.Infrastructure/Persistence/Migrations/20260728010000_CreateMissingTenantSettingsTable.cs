using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace AipPortal.Infrastructure.Persistence.Migrations;

/// <summary>
/// Repairs the historical migration chain omission for the already-modelled
/// tenant_settings table. The model snapshot has always contained this entity,
/// but a clean database did not receive its physical table.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260728010000_CreateMissingTenantSettingsTable")]
public sealed class CreateMissingTenantSettingsTable : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "tenant_settings",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                DisplayName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                LogoFileId = table.Column<Guid>(type: "uuid", nullable: true),
                ThemeColor = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                DefaultLocale = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                TimeZone = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                InvitationMode = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                StorageQuotaBytes = table.Column<long>(type: "bigint", nullable: false),
                UserLimit = table.Column<int>(type: "integer", nullable: false),
                ProjectLimit = table.Column<int>(type: "integer", nullable: false),
                FileUploadLimitBytes = table.Column<long>(type: "bigint", nullable: false),
                FeatureFlagsJson = table.Column<string>(type: "jsonb", nullable: false),
                NotificationSettingsJson = table.Column<string>(type: "jsonb", nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_tenant_settings", x => x.Id);
                table.ForeignKey(
                    name: "FK_tenant_settings_file_objects_LogoFileId",
                    column: x => x.LogoFileId,
                    principalTable: "file_objects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.SetNull);
                table.ForeignKey(
                    name: "FK_tenant_settings_tenants_TenantId",
                    column: x => x.TenantId,
                    principalTable: "tenants",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(
            name: "IX_tenant_settings_CreatedAt",
            table: "tenant_settings",
            column: "CreatedAt");

        migrationBuilder.CreateIndex(
            name: "IX_tenant_settings_LogoFileId",
            table: "tenant_settings",
            column: "LogoFileId");

        migrationBuilder.CreateIndex(
            name: "IX_tenant_settings_TenantId",
            table: "tenant_settings",
            column: "TenantId",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "tenant_settings");
    }
}
