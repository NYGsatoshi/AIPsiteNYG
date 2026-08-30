using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AipPortal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskExecutionResearchPlanSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SnapshotResearchPlanRevisionId",
                table: "task_execution_runs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "SnapshotResearchPlanRevisionNo",
                table: "task_execution_runs",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_research_plan_revisions_execution_snapshot_identity",
                table: "research_plan_revisions",
                columns: new[] { "Id", "TenantId", "WorkspaceId", "ProjectId", "TaskItemId", "RevisionNo" });

            migrationBuilder.CreateIndex(
                name: "IX_task_execution_runs_plan_snapshot_lookup",
                table: "task_execution_runs",
                columns: new[] { "TenantId", "TaskItemId", "SnapshotResearchPlanRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_task_execution_runs_plan_snapshot_scope",
                table: "task_execution_runs",
                columns: new[] { "SnapshotResearchPlanRevisionId", "TenantId", "WorkspaceId", "ProjectId", "TaskItemId", "SnapshotResearchPlanRevisionNo" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_task_execution_runs_research_plan_snapshot",
                table: "task_execution_runs",
                sql: "(\"SnapshotResearchPlanRevisionId\" IS NULL AND \"SnapshotResearchPlanRevisionNo\" IS NULL) OR (\"SnapshotResearchPlanRevisionId\" IS NOT NULL AND \"SnapshotResearchPlanRevisionNo\" IS NOT NULL AND \"SnapshotResearchPlanRevisionNo\" > 0)");

            migrationBuilder.AddForeignKey(
                name: "FK_task_execution_runs_plan_snapshot_revision",
                table: "task_execution_runs",
                columns: new[] { "SnapshotResearchPlanRevisionId", "TenantId", "WorkspaceId", "ProjectId", "TaskItemId", "SnapshotResearchPlanRevisionNo" },
                principalTable: "research_plan_revisions",
                principalColumns: new[] { "Id", "TenantId", "WorkspaceId", "ProjectId", "TaskItemId", "RevisionNo" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_task_execution_runs_plan_snapshot_revision",
                table: "task_execution_runs");

            migrationBuilder.DropIndex(
                name: "IX_task_execution_runs_plan_snapshot_lookup",
                table: "task_execution_runs");

            migrationBuilder.DropIndex(
                name: "IX_task_execution_runs_plan_snapshot_scope",
                table: "task_execution_runs");

            migrationBuilder.DropCheckConstraint(
                name: "CK_task_execution_runs_research_plan_snapshot",
                table: "task_execution_runs");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_research_plan_revisions_execution_snapshot_identity",
                table: "research_plan_revisions");

            migrationBuilder.DropColumn(
                name: "SnapshotResearchPlanRevisionId",
                table: "task_execution_runs");

            migrationBuilder.DropColumn(
                name: "SnapshotResearchPlanRevisionNo",
                table: "task_execution_runs");
        }
    }
}
