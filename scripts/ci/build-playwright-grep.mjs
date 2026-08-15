import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const manifestPath = args.shift();

if (!manifestPath) {
  fail('Usage: node scripts/ci/build-playwright-grep.mjs <manifest> [--verify <spec-file>]');
}

let verifyPath = '';
while (args.length > 0) {
  const argument = args.shift();
  if (argument !== '--verify') {
    fail(`Unknown argument: ${argument}`);
  }

  verifyPath = args.shift() ?? '';
  if (!verifyPath) {
    fail('--verify requires a spec file path.');
  }
}

const manifest = await readFile(manifestPath, 'utf8');
const testTitles = manifest
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

if (testTitles.length === 0) {
  fail(`Required-test manifest contains no active test titles: ${manifestPath}`);
}

const duplicates = testTitles.filter((title, index) => testTitles.indexOf(title) !== index);
if (duplicates.length > 0) {
  fail(`Required-test manifest contains duplicate titles: ${[...new Set(duplicates)].join(', ')}`);
}

if (verifyPath) {
  const specSource = await readFile(verifyPath, 'utf8');
  const missingTitles = testTitles.filter(
    (title) => !specSource.includes(`test('${title}'`) && !specSource.includes(`test("${title}"`)
  );

  if (missingTitles.length > 0) {
    fail(
      `Required real-backend tests are missing or renamed in ${verifyPath}:\n${missingTitles
        .map((title) => `  - ${title}`)
        .join('\n')}`
    );
  }
}

const escapedTitles = testTitles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
process.stdout.write(`^(${escapedTitles.join('|')})$`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
