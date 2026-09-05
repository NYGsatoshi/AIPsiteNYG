import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '../..');
const artifactsRoot = path.join(repoRoot, 'artifacts', 'frontend-inspections');
const parentSha = 'f78c0cd5794cbb88e3774f5be5a70d6272bb47ba';
const sourceRoots = ['frontend/src/app', 'aipsite-frontend/src'];

async function collectTypeScriptFiles(relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(relativePath));
    } else if (entry.isFile() && relativePath.endsWith('.ts')) {
      files.push(relativePath);
    }
  }
  return files;
}

async function fetchParentSource(filePath) {
  const url = `https://raw.githubusercontent.com/NYGsatoshi/AIPsiteNYG/${parentSha}/${filePath}`;
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unable to fetch ${filePath} at ${parentSha}: ${response.status}`);
  }
  return response.text();
}

await mkdir(artifactsRoot, { recursive: true });

const candidateFiles = (await Promise.all(sourceRoots.map(collectTypeScriptFiles)))
  .flat()
  .sort();
const snapshots = {};
const missingFromParent = [];

for (const filePath of candidateFiles) {
  const current = await readFile(path.join(repoRoot, filePath), 'utf8');
  if (!current.includes('ChangeDetectionStrategy.Eager')) {
    continue;
  }
  const parent = await fetchParentSource(filePath);
  if (parent === null) {
    missingFromParent.push(filePath);
    continue;
  }
  snapshots[filePath] = { parent, current };
}

await writeFile(
  path.join(artifactsRoot, 'ang22-source-snapshots.json'),
  JSON.stringify({ parentSha, snapshots, missingFromParent }),
  'utf8'
);

console.log(
  `Angular 22 source snapshot: captured=${Object.keys(snapshots).length}, missing=${missingFromParent.length}`
);
