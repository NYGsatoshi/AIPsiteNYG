import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import yaml from 'js-yaml';

const runnerPath = 'scripts/ci/run-fci07-functional-security.sh';
const overlayPath = 'docker-compose.fci07-functional-security.yml';
const specPath = 'tests/functional/security-negative/cross-scope-negative-matrix.spec.ts';

test('FCI-07 runner is syntactically valid and keeps the security fixture boundary explicit', () => {
  const syntax = spawnSync('bash', ['-n', runnerPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || 'bash -n failed');

  const runner = readFileSync(runnerPath, 'utf8');
  for (const gate of ['functional-fast', 'functional-full', 'functional-extended']) {
    assert.match(runner, new RegExp(gate));
  }
  assert.match(runner, /docker-compose\.security\.yml/);
  assert.match(runner, /docker-compose\.fci07-functional-security\.yml/);

  const overlay = readFileSync(overlayPath, 'utf8');
  const parsed = yaml.load(overlay);
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  const service = parsed.services?.['real-backend-playwright'];
  assert.equal(service?.environment?.AIP_SECURITY_CI_FIXTURE_ENABLED, 'true');
  assert.match(String(service?.environment?.AIP_SECURITY_CI_PASSWORD ?? ''), /AIP_SECURITY_CI_PASSWORD/);
  assert.match(String(service?.command ?? ''), /--domain security-negative/);
  assert.match(String(service?.command ?? ''), /--negative-authz/);
});

test('FCI-07 owner spec cannot silently turn the negative matrix into skipped green coverage', () => {
  const spec = readFileSync(specPath, 'utf8');
  assert.match(spec, /journeyId:\s*'FUNC-AUTHZ-001'/);
  assert.match(spec, /journeyId:\s*'FUNC-AUTHZ-002'/);
  assert.match(spec, /negativeAuthz:\s*true/);
  assert.doesNotMatch(spec, /\btest\.(?:skip|fixme)\b/);

  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.scripts['test:functional:fci07'], 'bash scripts/ci/run-fci07-functional-security.sh functional-fast');
  assert.equal(packageJson.scripts['test:functional:fci07:full'], 'bash scripts/ci/run-fci07-functional-security.sh functional-full');
  assert.equal(packageJson.scripts['test:functional:fci07:extended'], 'bash scripts/ci/run-fci07-functional-security.sh functional-extended');
});
