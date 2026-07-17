import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputRoot = fileURLToPath(new URL('../dist/aipportal-web/', import.meta.url));
const index = await readFile(join(outputRoot, 'index.html'), 'utf8');
const initialScripts = [...index.matchAll(/src="([^"?]+\.js)"/gu)].map((match) => match[1]);

if (initialScripts.length === 0) {
  throw new Error('Bundle analysis could not identify initial JavaScript chunks.');
}

for (const script of initialScripts) {
  const contents = await readFile(join(outputRoot, script), 'utf8');
  if (contents.includes('@syncfusion/') || contents.includes('ej2-')) {
    throw new Error(`Syncfusion code entered the initial bundle: ${script}`);
  }
}

const bundleFiles = await readdir(outputRoot);
const lazyScripts = bundleFiles.filter((file) => file.endsWith('.js') && !initialScripts.includes(file));
const syncfusionChunk = await Promise.any(lazyScripts.map(async (file) => {
  const contents = await readFile(join(outputRoot, file), 'utf8');
  if (contents.includes('ejs-grid')) {
    return file;
  }
  throw new Error('not the Syncfusion grid chunk');
})).catch(() => null);

if (!syncfusionChunk) {
  throw new Error('Bundle analysis could not identify the lazy Syncfusion grid chunk.');
}

console.log(`Verified ${initialScripts.length} initial chunks and lazy Syncfusion grid chunk ${syncfusionChunk}; ${bundleFiles.filter((file) => file.endsWith('.js')).length} JavaScript bundles inspected.`);
