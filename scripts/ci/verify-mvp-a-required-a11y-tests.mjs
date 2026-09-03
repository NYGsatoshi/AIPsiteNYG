import fs from 'node:fs';
import path from 'node:path';

const manifestPath = process.argv[2] ?? 'scripts/ci/mvp-a-required-a11y-tests.txt';
const manifest = fs.readFileSync(manifestPath, 'utf8');
const errors = [];
let requiredCount = 0;

for (const [index, rawLine] of manifest.split(/\r?\n/).entries()) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;

  const separator = line.indexOf('|');
  if (separator <= 0 || separator === line.length - 1) {
    errors.push(`${manifestPath}:${index + 1}: expected <spec path>|<required title fragment>`);
    continue;
  }

  const relativePath = line.slice(0, separator).trim();
  const titleFragment = line.slice(separator + 1).trim();
  const absolutePath = path.resolve(relativePath);
  requiredCount += 1;

  if (!fs.existsSync(absolutePath)) {
    errors.push(`${relativePath}: required spec is missing`);
    continue;
  }

  const source = fs.readFileSync(absolutePath, 'utf8');
  if (!source.includes(titleFragment)) {
    errors.push(`${relativePath}: required title fragment is missing: ${JSON.stringify(titleFragment)}`);
  }
}

if (requiredCount === 0) {
  errors.push(`${manifestPath}: manifest contains no required tests`);
}

if (errors.length > 0) {
  console.error('MVP-A accessibility required-test policy failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`MVP-A accessibility required-test policy passed: ${requiredCount} required tests are present.`);
