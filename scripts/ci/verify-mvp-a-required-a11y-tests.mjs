/* eslint-disable -- CI policy verifier uses explicit fail-closed control flow and is not production-bundled. */
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = process.argv[2] ?? 'scripts/ci/mvp-a-required-a11y-tests.txt';
const runnerPath = process.argv[3] ?? 'tests/ui/run-angular-playwright.mjs';
const manifest = fs.readFileSync(manifestPath, 'utf8');
const runnerSource = fs.readFileSync(runnerPath, 'utf8');
const errors = [];
const seenAreas = new Set();
let requiredCount = 0;

for (const [index, rawLine] of manifest.split(/\r?\n/).entries()) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;

  const fields = line.split('|').map((value) => value.trim());
  if (fields.length !== 3 || fields.some((value) => !value)) {
    errors.push(`${manifestPath}:${index + 1}: expected <area>|<spec path>|<required title fragment>`);
    continue;
  }

  const [area, relativePath, titleFragment] = fields;
  const absolutePath = path.resolve(relativePath);
  requiredCount += 1;

  if (seenAreas.has(area)) {
    errors.push(`${manifestPath}:${index + 1}: duplicate area ${JSON.stringify(area)}`);
  }
  seenAreas.add(area);

  if (!fs.existsSync(absolutePath)) {
    errors.push(`${relativePath}: required spec for ${area} is missing`);
    continue;
  }

  const source = fs.readFileSync(absolutePath, 'utf8');
  if (!source.includes(titleFragment)) {
    errors.push(`${relativePath}: required ${area} test title fragment is missing: ${JSON.stringify(titleFragment)}`);
  }
  if (!source.includes('expectNoAccessibilityViolations')) {
    errors.push(`${relativePath}: required ${area} spec no longer contains axe accessibility coverage`);
  }
  if (!/width\s*:\s*320|chromium-mobile/u.test(source)) {
    errors.push(`${relativePath}: required ${area} spec no longer contains a 320px/mobile execution path`);
  }
  if (!runnerSource.includes(`'${relativePath}'`) && !runnerSource.includes(`\"${relativePath}\"`)) {
    errors.push(`${runnerPath}: required ${area} spec is not registered in the canonical Angular Playwright suite: ${relativePath}`);
  }
}

if (requiredCount === 0) {
  errors.push(`${manifestPath}: manifest contains no required tests`);
}

const requiredAreas = ['Workspace', 'Project / Task', 'Files', 'Message', 'Audit', 'Announcement'];
for (const area of requiredAreas) {
  if (!seenAreas.has(area)) {
    errors.push(`${manifestPath}: required MVP-A area is missing: ${area}`);
  }
}

if (errors.length > 0) {
  console.error('MVP-A accessibility required-test policy failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `MVP-A accessibility required-test policy passed: ${requiredCount} required tests cover ${requiredAreas.length} MVP-A areas and are registered in the canonical Playwright suite.`
);
