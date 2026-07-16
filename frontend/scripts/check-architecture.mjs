import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/app/', import.meta.url));
const allowlist = '/shared/vendor/syncfusion/';
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
const offenders = [];
for (const file of await files(root)) {
  if (!file.endsWith('.ts') || file.includes(allowlist)) continue;
  if (/@syncfusion\/ej2-[\w-]+/.test(await readFile(file, 'utf8'))) offenders.push(file);
}
if (offenders.length) throw new Error(`Direct Syncfusion imports outside the AIPsite adapter boundary:\n${offenders.join('\n')}`);