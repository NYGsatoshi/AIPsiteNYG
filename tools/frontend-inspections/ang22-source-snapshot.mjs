import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '../..');
const artifactsRoot = path.join(repoRoot, 'artifacts', 'frontend-inspections');
const parentSha = 'f78c0cd5794cbb88e3774f5be5a70d6272bb47ba';
const paths = [
  'frontend/src/app/core/session/session-expired-page.component.ts',
  'frontend/src/app/features/admin/audit-log-page/audit-log-page.component.ts',
  'frontend/src/app/features/admin/audit-package-export-page/audit-package-export-page.component.ts',
  'frontend/src/app/features/files/files-page/files-page.component.ts',
  'frontend/src/app/features/messaging/conversation-settings-panel/conversation-settings-panel.component.ts',
  'frontend/src/app/features/messaging/message-settings-page/message-settings-page.component.ts',
  'frontend/src/app/features/messaging/messages-page/messages-page.component.ts',
  'frontend/src/app/features/messaging/new-message-banner/new-message-banner.component.ts',
  'frontend/src/app/features/projects/project-detail-page/project-detail-page.component.ts',
  'frontend/src/app/features/projects/task-brief-fields/task-brief-fields.component.ts',
  'frontend/src/app/features/projects/task-detail-page/task-detail-page.component.ts',
  'frontend/src/app/features/projects/task-execution-scope/task-execution-scope.component.ts',
  'frontend/src/app/features/projects/task-research-plan/task-research-plan.component.ts',
  'frontend/src/app/shared/mention-input/app-mention-input.component.ts'
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
for (let index = 0; index < paths.length; index += 7) {
  const batch = paths.slice(index, index + 7);
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
