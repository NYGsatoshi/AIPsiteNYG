import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'require-syncfusion-license.mjs'
);

function runLicenseCheck(value, includeVariable = true) {
  const env = { ...process.env };
  delete env.SYNCFUSION_LICENSE;

  if (includeVariable) {
    env.SYNCFUSION_LICENSE = value;
  }

  return spawnSync(process.execPath, [scriptPath], {
    env,
    encoding: 'utf8'
  });
}

test('fails closed when SYNCFUSION_LICENSE is missing', () => {
  const result = runLicenseCheck('', false);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /SYNCFUSION_LICENSE is not configured\./);
});

test('fails closed when SYNCFUSION_LICENSE is empty or whitespace-only', () => {
  for (const value of ['', '   ', '\t\n']) {
    const result = runLicenseCheck(value);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /SYNCFUSION_LICENSE is not configured\./);
  }
});

test('accepts a non-empty license without printing it', () => {
  const license = 'test-license-value';
  const result = runLicenseCheck(license);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(license), false);
  assert.equal(result.stderr.includes(license), false);
});
