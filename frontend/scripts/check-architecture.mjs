import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SYNCFUSION_IMPORT_PATTERN = /@syncfusion\/ej2-[\w-]+/u;
const allowedPaths = ['/shared/ui/adapters/syncfusion/', '/shared/vendor/syncfusion/'];

export function findDisallowedSyncfusionImports(sources) {
  return sources
    .filter(({ path, source }) => {
      const normalizedPath = path.replaceAll('\\', '/');
      return SYNCFUSION_IMPORT_PATTERN.test(source) && !allowedPaths.some((allowedPath) => normalizedPath.includes(allowedPath));
    })
    .map(({ path }) => path);
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

export async function validateSyncfusionImportBoundary(root) {
  const sourceFiles = (await files(root)).filter((file) => file.endsWith('.ts'));
  const sources = await Promise.all(sourceFiles.map(async (path) => ({ path, source: await readFile(path, 'utf8') })));
  return findDisallowedSyncfusionImports(sources);
}

const root = fileURLToPath(new URL('../src/app/', import.meta.url));
const offenders = await validateSyncfusionImportBoundary(root);
if (offenders.length) {
  throw new Error(`Direct Syncfusion imports outside the AIPsite adapter boundary:\n${offenders.join('\n')}`);
}
