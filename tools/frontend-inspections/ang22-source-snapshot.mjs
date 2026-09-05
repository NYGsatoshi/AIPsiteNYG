import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '../..');
const artifactsRoot = path.join(repoRoot, 'artifacts', 'frontend-inspections');
const parentSha = "f78c0cd5794cbb88e3774f5be5a70d6272bb47ba";
const paths = [
  "frontend/src/app/app.ts",
  "frontend/src/app/core/routing/page-placeholder.component.ts",
  "frontend/src/app/core/session/session-expired-page.component.ts",
  "frontend/src/app/features/account/account-page/account-page.component.ts",
  "frontend/src/app/features/account/account-profile-panel/account-profile-panel.component.ts",
  "frontend/src/app/features/account/account-status-panel/account-status-panel.component.ts",
  "frontend/src/app/features/account/language-preferences/language-preferences.component.ts",
  "frontend/src/app/features/account/session-list/session-list.component.ts",
  "frontend/src/app/features/account/task-notification-preferences/task-notification-preferences.component.ts",
  "frontend/src/app/features/admin/audit-claims-evidence-page/audit-claims-evidence-page.component.ts",
  "frontend/src/app/features/admin/audit-detail-drawer/audit-detail-drawer.component.ts",
  "frontend/src/app/features/admin/audit-findings-page/audit-finding-decision-panel.component.ts",
  "frontend/src/app/features/admin/audit-findings-page/audit-findings-page.component.ts",
  "frontend/src/app/features/admin/audit-log-page/audit-log-page.component.ts",
  "frontend/src/app/features/admin/audit-package-export-page/audit-package-export-page.component.ts",
  "frontend/src/app/features/admin/audit-result-badge/audit-result-badge.component.ts",
  "frontend/src/app/features/admin/audit-severity-badge/audit-severity-badge.component.ts",
  "frontend/src/app/features/admin/export-diagnostics-page/export-diagnostics-page.component.ts",
  "frontend/src/app/features/admin/invite-admin-page/invite-admin-page.component.ts",
  "frontend/src/app/features/announcements/announcement-action-panel/announcement-action-panel.component.ts",
  "frontend/src/app/features/announcements/announcement-audience-preview/announcement-audience-preview.component.ts",
  "frontend/src/app/features/announcements/announcement-publication-status/announcement-publication-status.component.ts",
  "frontend/src/app/features/announcements/announcement-read-state/announcement-read-state.component.ts",
  "frontend/src/app/features/artifacts/artifact-detail-page/artifact-detail-page.component.ts",
  "frontend/src/app/features/auth/invite-registration-page/invite-registration-page.component.ts",
  "frontend/src/app/features/auth/invite-token-state-panel/invite-token-state-panel.component.ts",
  "frontend/src/app/features/files/file-move-dialog/file-move-dialog.component.ts",
  "frontend/src/app/features/files/file-quota-state/file-quota-state.component.ts",
  "frontend/src/app/features/files/file-scan-status-badge/file-scan-status-badge.component.ts",
  "frontend/src/app/features/files/files-page/files-page.component.ts",
  "frontend/src/app/features/messaging/channel-messaging-page/channel-messaging-page.component.ts",
  "frontend/src/app/features/messaging/conversation-settings-panel/conversation-settings-panel.component.ts",
  "frontend/src/app/features/messaging/failed-message-item/failed-message-item.component.ts",
  "frontend/src/app/features/messaging/message-composer/message-composer.component.ts",
  "frontend/src/app/features/messaging/message-item/message-item.component.ts",
  "frontend/src/app/features/messaging/message-search-filters/message-search-filters.component.ts",
  "frontend/src/app/features/messaging/message-settings-page/message-settings-page.component.ts",
  "frontend/src/app/features/messaging/messages-page/messages-page.component.ts",
  "frontend/src/app/features/messaging/new-message-banner/new-message-banner.component.ts",
  "frontend/src/app/features/projects/my-tasks-page/my-tasks-page.component.ts",
  "frontend/src/app/features/projects/project-detail-page/project-detail-page.component.ts",
  "frontend/src/app/features/projects/projects-overview-page/projects-overview-page.component.ts",
  "frontend/src/app/features/projects/task-brief-fields/task-brief-fields.component.ts",
  "frontend/src/app/features/projects/task-detail-page/task-detail-page.component.ts",
  "frontend/src/app/features/projects/task-execution-result/task-execution-result.component.ts",
  "frontend/src/app/features/projects/task-execution-scope/task-execution-scope.component.ts",
  "frontend/src/app/features/projects/task-research-plan/task-research-plan.component.ts",
  "frontend/src/app/features/projects/task-status-badge/task-status-badge.component.ts",
  "frontend/src/app/features/workspaces/member-role-badge/member-role-badge.component.ts",
  "frontend/src/app/features/workspaces/workspace-empty-state/workspace-empty-state.component.ts",
  "frontend/src/app/features/workspaces/workspace-members-page/workspace-members-page.component.ts",
  "frontend/src/app/features/workspaces/workspace-research-quick-create-page/workspace-research-quick-create-page.component.ts",
  "frontend/src/app/layout/account-rail/account-rail.component.ts",
  "frontend/src/app/layout/app-shell/app-shell.component.ts",
  "frontend/src/app/layout/mobile-header/mobile-header.component.ts",
  "frontend/src/app/layout/workspace-search/workspace-search.component.ts",
  "frontend/src/app/shared/dialog/app-confirm-dialog/app-confirm-dialog.component.ts",
  "frontend/src/app/shared/empty-state/app-empty-state/app-empty-state.component.ts",
  "frontend/src/app/shared/error/app-error-summary/app-error-summary.component.ts",
  "frontend/src/app/shared/error/app-request-id/app-request-id.component.ts",
  "frontend/src/app/shared/form/app-field-error/app-field-error.component.ts",
  "frontend/src/app/shared/form/app-form-actions/app-form-actions.component.ts",
  "frontend/src/app/shared/grid/app-data-grid/app-data-grid.component.ts",
  "frontend/src/app/shared/loading/app-inline-loading/app-inline-loading.component.ts",
  "frontend/src/app/shared/loading/app-skeleton/app-skeleton.component.ts",
  "frontend/src/app/shared/mention-input/app-mention-input.component.ts",
  "frontend/src/app/shared/permission/app-permission-denied/app-permission-denied.component.ts",
  "frontend/src/app/shared/permission/app-preview-disabled/app-preview-disabled.component.ts",
  "frontend/src/app/shared/permission/app-safe-not-found/app-safe-not-found.component.ts",
  "frontend/src/app/shared/right-panel/member-list-item/member-list-item.component.ts",
  "frontend/src/app/shared/right-panel/members-tab/members-tab.component.ts",
  "frontend/src/app/shared/right-panel/notification-item/notification-item.component.ts",
  "frontend/src/app/shared/right-panel/right-panel/right-panel.component.ts",
  "frontend/src/app/shared/theme/aip-theme-toggle/aip-theme-toggle.component.ts",
  "frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-data-grid.component.ts",
  "frontend/src/app/shared/ui/aip-filter-chip/aip-filter-chip.component.ts",
  "frontend/src/app/shared/ui/badge/app-badge.component.ts",
  "frontend/src/app/shared/ui/button/app-button.component.ts",
  "frontend/src/app/shared/ui/card/app-card.component.ts",
  "frontend/src/app/shared/ui/empty/app-empty.component.ts",
  "frontend/src/app/shared/ui/icon/app-icon.component.ts",
  "frontend/src/app/shared/ui/input/app-input.component.ts",
  "frontend/src/app/shared/ui/menu/app-menu.component.ts",
  "frontend/src/app/shared/ui/modal/app-modal.component.ts",
  "frontend/src/app/shared/ui/popover/app-popover.component.ts",
  "frontend/src/app/shared/ui/progress/app-progress.component.ts",
  "frontend/src/app/shared/ui/select/app-select.component.ts",
  "frontend/src/app/shared/ui/spinner/app-spinner.component.ts",
  "frontend/src/app/shared/ui/tabs/app-tabs.component.ts",
  "frontend/src/app/shared/ui/tooltip/app-tooltip.component.ts",
  "frontend/src/app/shared/ui/tree/app-tree.component.ts",
  "frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-gantt.component.ts",
  "frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-kanban.component.ts",
  "frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-rich-text-editor.component.ts",
  "frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-splitter.component.ts",
  "frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-uploader.component.ts",
  "frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-dialog.component.ts",
  "frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-dropdown.component.ts"
];

await mkdir(artifactsRoot, { recursive: true });

async function fetchParentSource(filePath) {
  const url = `https://raw.githubusercontent.com/NYGsatoshi/AIPsiteNYG/${parentSha}/${filePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${filePath} at ${parentSha}: ${response.status}`);
  }
  return response.text();
}

const snapshots = {};
for (let index = 0; index < paths.length; index += 12) {
  const batch = paths.slice(index, index + 12);
  const entries = await Promise.all(
    batch.map(async (filePath) => [
      filePath,
      {
        parent: await fetchParentSource(filePath),
        current: await readFile(path.join(repoRoot, filePath), 'utf8')
      }
    ])
  );
  Object.assign(snapshots, Object.fromEntries(entries));
}

await writeFile(
  path.join(artifactsRoot, 'ang22-source-snapshots.json'),
  JSON.stringify({ parentSha, snapshots }),
  'utf8'
);
