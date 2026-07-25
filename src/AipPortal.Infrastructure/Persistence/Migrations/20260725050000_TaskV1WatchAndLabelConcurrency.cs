using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace AipPortal.Infrastructure.Persistence.Migrations;

/// <summary>Establishes durable automatic Watch state for existing Tasks and database concurrency defaults.</summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260725050000_TaskV1WatchAndLabelConcurrency")]
public sealed class TaskV1WatchAndLabelConcurrency : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
UPDATE work_item_watch_states SET "VersionNo" = 1 WHERE "VersionNo" < 1;
UPDATE project_task_labels SET "VersionNo" = 1 WHERE "VersionNo" < 1;
ALTER TABLE work_item_watch_states ALTER COLUMN "VersionNo" SET DEFAULT 1;
ALTER TABLE project_task_labels ALTER COLUMN "VersionNo" SET DEFAULT 1;

WITH automatic_sources AS (
    SELECT t."TenantId", t."Id" AS "TaskItemId", t."CreatedByUserId" AS "UserId", 1 AS "Source"
    FROM task_items t WHERE t."DeletedAt" IS NULL
    UNION ALL
    SELECT t."TenantId", t."Id", t."PrimaryAssigneeUserId", 2
    FROM task_items t WHERE t."DeletedAt" IS NULL AND t."PrimaryAssigneeUserId" IS NOT NULL
    UNION ALL
    SELECT t."TenantId", t."Id", t."ReviewerUserId", 8
    FROM task_items t WHERE t."DeletedAt" IS NULL AND t."ReviewerUserId" IS NOT NULL
    UNION ALL
    SELECT c."TenantId", c."TaskItemId", c."UserId", 4
    FROM task_item_collaborators c
    INNER JOIN task_items t ON t."Id" = c."TaskItemId" AND t."TenantId" = c."TenantId"
    WHERE t."DeletedAt" IS NULL
), combined_sources AS (
    SELECT "TenantId", "TaskItemId", "UserId", bit_or("Source")::integer AS "AutomaticSources"
    FROM automatic_sources
    WHERE "UserId" IS NOT NULL
    GROUP BY "TenantId", "TaskItemId", "UserId"
)
INSERT INTO work_item_watch_states ("Id", "TenantId", "TaskItemId", "UserId", "AutomaticSources", "IsExplicitOptOut", "IsWatching", "UpdatedAt", "VersionNo")
SELECT gen_random_uuid(), "TenantId", "TaskItemId", "UserId", "AutomaticSources", false, true, CURRENT_TIMESTAMP, 1
FROM combined_sources
ON CONFLICT ("TenantId", "TaskItemId", "UserId") DO UPDATE
SET "AutomaticSources" = EXCLUDED."AutomaticSources",
    "IsWatching" = CASE
        WHEN work_item_watch_states."IsExplicitOptOut" THEN false
        WHEN work_item_watch_states."IsWatching" THEN true
        WHEN EXCLUDED."AutomaticSources" <> 0 THEN true
        ELSE false
    END,
    "UpdatedAt" = CASE
        WHEN work_item_watch_states."AutomaticSources" IS DISTINCT FROM EXCLUDED."AutomaticSources" THEN CURRENT_TIMESTAMP
        ELSE work_item_watch_states."UpdatedAt"
    END,
    "VersionNo" = CASE
        WHEN work_item_watch_states."AutomaticSources" IS DISTINCT FROM EXCLUDED."AutomaticSources" THEN work_item_watch_states."VersionNo" + 1
        ELSE work_item_watch_states."VersionNo"
    END;

WITH automatic_sources AS (
    SELECT t."TenantId", t."Id" AS "TaskItemId", t."CreatedByUserId" AS "UserId", 1 AS "Source"
    FROM task_items t WHERE t."DeletedAt" IS NULL
    UNION ALL
    SELECT t."TenantId", t."Id", t."PrimaryAssigneeUserId", 2
    FROM task_items t WHERE t."DeletedAt" IS NULL AND t."PrimaryAssigneeUserId" IS NOT NULL
    UNION ALL
    SELECT t."TenantId", t."Id", t."ReviewerUserId", 8
    FROM task_items t WHERE t."DeletedAt" IS NULL AND t."ReviewerUserId" IS NOT NULL
    UNION ALL
    SELECT c."TenantId", c."TaskItemId", c."UserId", 4
    FROM task_item_collaborators c
    INNER JOIN task_items t ON t."Id" = c."TaskItemId" AND t."TenantId" = c."TenantId"
    WHERE t."DeletedAt" IS NULL
), combined_sources AS (
    SELECT "TenantId", "TaskItemId", "UserId", bit_or("Source")::integer AS "AutomaticSources"
    FROM automatic_sources
    WHERE "UserId" IS NOT NULL
    GROUP BY "TenantId", "TaskItemId", "UserId"
)
UPDATE work_item_watch_states state
SET "AutomaticSources" = COALESCE(combined_sources."AutomaticSources", 0),
    "IsWatching" = CASE
        WHEN state."IsExplicitOptOut" THEN false
        WHEN state."IsWatching" THEN true
        WHEN COALESCE(combined_sources."AutomaticSources", 0) <> 0 THEN true
        ELSE false
    END,
    "UpdatedAt" = CURRENT_TIMESTAMP,
    "VersionNo" = state."VersionNo" + 1
FROM task_items task
LEFT JOIN combined_sources ON combined_sources."TenantId" = state."TenantId"
    AND combined_sources."TaskItemId" = state."TaskItemId"
    AND combined_sources."UserId" = state."UserId"
WHERE state."TaskItemId" = task."Id"
  AND state."TenantId" = task."TenantId"
  AND task."DeletedAt" IS NULL
  AND state."AutomaticSources" IS DISTINCT FROM COALESCE(combined_sources."AutomaticSources", 0);
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
ALTER TABLE work_item_watch_states ALTER COLUMN "VersionNo" DROP DEFAULT;
ALTER TABLE project_task_labels ALTER COLUMN "VersionNo" DROP DEFAULT;
""");
    }
}
