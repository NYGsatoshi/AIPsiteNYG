import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SYNCFUSION_IMPORT_PATTERN = /@syncfusion\/ej2-[\w-]+/u;
export const SIGNALR_IMPORT_PATTERN = /@microsoft\/signalr/u;
export const AG_GRID_ENTERPRISE_PATTERN = /(?:from\s+['"]ag-grid-enterprise['"]|require\(['"]ag-grid-enterprise['"]\))/u;
const allowedPaths = ['/shared/ui/adapters/syncfusion/', '/shared/vendor/syncfusion/'];
const allowedSignalrPaths = ['/core/realtime/signalr-realtime.transport.ts'];

export function findDisallowedSyncfusionImports(sources) {
  return sources
    .filter(({ path, source }) => {
      const normalizedPath = path.replaceAll('\\', '/');
      return SYNCFUSION_IMPORT_PATTERN.test(source) && !allowedPaths.some((allowedPath) => normalizedPath.includes(allowedPath));
    })
    .map(({ path }) => path);
}

export function findDisallowedSignalrImports(sources) {
  return sources
    .filter(({ path, source }) => {
      const normalizedPath = path.replaceAll('\\', '/');
      return SIGNALR_IMPORT_PATTERN.test(source) && !allowedSignalrPaths.some((allowedPath) => normalizedPath.endsWith(allowedPath));
    })
    .map(({ path }) => path);
}

export function findAgGridEnterpriseImports(sources) {
  return sources.filter(({ source }) => AG_GRID_ENTERPRISE_PATTERN.test(source)).map(({ path }) => path);
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
const signalrOffenders = findDisallowedSignalrImports(await Promise.all((await files(root))
  .filter((file) => file.endsWith('.ts'))
  .map(async (path) => ({ path, source: await readFile(path, 'utf8') }))));
const enterpriseOffenders = findAgGridEnterpriseImports(await Promise.all((await files(root))
  .filter((file) => file.endsWith('.ts'))
  .map(async (path) => ({ path, source: await readFile(path, 'utf8') }))));
if (offenders.length || signalrOffenders.length || enterpriseOffenders.length) {
  const messages = [];
  if (offenders.length) messages.push(`Direct Syncfusion imports outside the AIPsite adapter boundary:\n${offenders.join('\n')}`);
  if (signalrOffenders.length) messages.push(`SignalR imports outside the AIPsite realtime transport boundary:\n${signalrOffenders.join('\n')}`);
  if (enterpriseOffenders.length) messages.push(`AG Grid Enterprise imports are not approved:\n${enterpriseOffenders.join('\n')}`);
  throw new Error(messages.join('\n'));
}
