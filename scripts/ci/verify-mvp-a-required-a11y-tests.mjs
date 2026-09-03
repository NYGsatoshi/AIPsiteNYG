import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_ARGUMENT_INDEX = 2,
  RUNNER_ARGUMENT_INDEX = 3,
  EXPECTED_FIELD_COUNT = 3,
  EMPTY_COUNT = 0,
  FIRST_LINE_NUMBER = 1,
  COUNT_INCREMENT = 1,
  FAILURE_EXIT_CODE = 1,
  manifestPath = process.argv[MANIFEST_ARGUMENT_INDEX] ?? 'scripts/ci/mvp-a-required-a11y-tests.txt',
  runnerPath = process.argv[RUNNER_ARGUMENT_INDEX] ?? 'tests/ui/run-angular-playwright.mjs',
  manifest = fs.readFileSync(manifestPath, 'utf8'),
  runnerSource = fs.readFileSync(runnerPath, 'utf8'),
  errors = [],
  seenAreas = new Set(),
  requiredAreas = ['Workspace', 'Project / Task', 'Files', 'Message', 'Audit', 'Announcement'];
let requiredCount = EMPTY_COUNT;

for (const [index, rawLine] of manifest.split(/\r?\n/u).entries()) {
  const line = rawLine.trim();
  if (line && !line.startsWith('#')) {
    const fields = line.split('|').map((value) => value.trim());
    if (fields.length !== EXPECTED_FIELD_COUNT || fields.some((value) => !value)) {
      errors.push(`${manifestPath}:${index + FIRST_LINE_NUMBER}: expected <area>|<spec path>|<required title fragment>`);
    } else {
      const [area, relativePath, titleFragment] = fields,
        absolutePath = path.resolve(relativePath),
        singleQuotedPath = `'${relativePath}'`,
        doubleQuotedPath = `"${relativePath}"`;
      requiredCount += COUNT_INCREMENT;

      if (seenAreas.has(area)) {
        errors.push(`${manifestPath}:${index + FIRST_LINE_NUMBER}: duplicate area ${JSON.stringify(area)}`);
      }
      seenAreas.add(area);

      if (!fs.existsSync(absolutePath)) {
        errors.push(`${relativePath}: required spec for ${area} is missing`);
      } else {
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
        if (!runnerSource.includes(singleQuotedPath) && !runnerSource.includes(doubleQuotedPath)) {
          errors.push(`${runnerPath}: required ${area} spec is not registered in the canonical Angular Playwright suite: ${relativePath}`);
        }
      }
    }
  }
}

if (requiredCount === EMPTY_COUNT) {
  errors.push(`${manifestPath}: manifest contains no required tests`);
}

for (const area of requiredAreas) {
  if (!seenAreas.has(area)) {
    errors.push(`${manifestPath}: required MVP-A area is missing: ${area}`);
  }
}

if (errors.length > EMPTY_COUNT) {
  process.stderr.write(`MVP-A accessibility required-test policy failed:\n- ${errors.join('\n- ')}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
} else {
  process.stdout.write(
    `MVP-A accessibility required-test policy passed: ${requiredCount} required tests cover ${requiredAreas.length} MVP-A areas and are registered in the canonical Playwright suite.\n`
  );
}
