import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  buildCanonicalFunctionalFixtureEnvironment,
  canonicalFunctionalFixtureAliases,
  composeProjectName,
  composeV2Invocation,
  formatFailureClassification,
  FunctionalComposeHarness,
  FunctionalFailureClassification,
  FunctionalHarnessError,
  getComposeProjectName,
  legacyComposeInvocation,
  normalizeExitCode,
  redactSecrets,
  selectComposeInvocation
} from '../../scripts/ci/functional-compose-harness.mjs';

test('sanitizes Compose project names and derives isolated run names', () => {
  const name = composeProjectName(['AIP site!', 'RUN/42', 'pid:123', 'x'.repeat(80)]);
  assert.match(name, /^[a-z0-9][a-z0-9_-]*$/);
  assert.ok(name.length <= 63);
  assert.equal(composeProjectName(['---']), 'aipsite-real-backend-smoke');

  const first = getComposeProjectName({ CI: 'true', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1' }, 1001);
  const second = getComposeProjectName({ CI: 'true', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1' }, 1002);
  assert.notEqual(first, second);
  assert.match(first, /^aipsite-functional-42-1-ci-/);
});

test('honors an explicit Functional Compose project override safely', () => {
  assert.equal(
    getComposeProjectName({ FUNCTIONAL_COMPOSE_PROJECT_NAME: 'FCI / Lane #1' }, 123),
    'fci-lane-1'
  );
});

test('builds the canonical synthetic fixture profile with stable aliases', () => {
  const environment = buildCanonicalFunctionalFixtureEnvironment({});
  assert.equal(environment.AIP_BROWSER_SMOKE_SEED_ENABLED, 'true');
  assert.equal(environment.AIP_BROWSER_SMOKE_RESPONSE_GATE_ENABLED, 'true');
  assert.equal(environment.AIP_BROWSER_SMOKE_EMAIL, canonicalFunctionalFixtureAliases.actorEmail);
  assert.equal(canonicalFunctionalFixtureAliases.restrictedActorEmail, 'browser-smoke-recipient@example.test');
  assert.equal(canonicalFunctionalFixtureAliases.eligibleFileName, 'browser-smoke-task.txt');
});

test('rejects non-synthetic fixture actor identities', () => {
  assert.throws(
    () => buildCanonicalFunctionalFixtureEnvironment({ AIP_BROWSER_SMOKE_EMAIL: 'person@example.com' }),
    (error) => error instanceof FunctionalHarnessError && error.phase === 'fixture-profile'
  );
});

test('prefers Docker Compose v2 and falls back to legacy Compose', async () => {
  const v2Calls = [];
  const v2 = await selectComposeInvocation(async (command, args) => {
    v2Calls.push([command, args]);
    return true;
  });
  assert.deepEqual(v2, composeV2Invocation);
  assert.deepEqual(v2Calls, [['docker', ['compose', 'version']]]);

  const legacyCalls = [];
  const legacy = await selectComposeInvocation(async (command, args) => {
    legacyCalls.push([command, args]);
    return command === 'docker-compose';
  });
  assert.deepEqual(legacy, legacyComposeInvocation);
  assert.deepEqual(legacyCalls, [
    ['docker', ['compose', 'version']],
    ['docker-compose', ['version']]
  ]);
});

test('classifies a missing Compose host as setup failure', async () => {
  await assert.rejects(
    () => selectComposeInvocation(async () => false),
    (error) =>
      error instanceof FunctionalHarnessError &&
      error.classification === FunctionalFailureClassification.setup &&
      error.phase === 'validate-host'
  );
});

test('redacts database, browser, license, cookies, tokens, and explicit secret values', () => {
  const redacted = redactSecrets([
    'Password=database-secret;Host=postgres',
    'AIP_BROWSER_SMOKE_PASSWORD: browser-secret',
    'SYNCFUSION_LICENSE=license-secret',
    'Authorization: Bearer api-secret',
    'Cookie: session=secret',
    'X-CSRF-Token: csrf-secret',
    'InvitationToken: invite-secret',
    '{"token":"json-secret","password":"json-password","license":"json-license"}',
    'opaque-runtime-secret'
  ].join('\n'), ['opaque-runtime-secret']);

  for (const secret of [
    'database-secret',
    'browser-secret',
    'license-secret',
    'api-secret',
    'session=secret',
    'csrf-secret',
    'invite-secret',
    'json-secret',
    'json-password',
    'json-license',
    'opaque-runtime-secret'
  ]) {
    assert.doesNotMatch(redacted, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('formats failure classification without exposing details beyond the supplied message', () => {
  assert.equal(
    formatFailureClassification(FunctionalFailureClassification.product, 'execute-suite', 'exit 7'),
    '[PRODUCT TEST FAILURE] phase=execute-suite: exit 7'
  );
  assert.equal(normalizeExitCode(37), 37);
  assert.equal(normalizeExitCode(null), 1);
});

test('cleanup is project-scoped, removes volumes/orphans, and runs only once', async () => {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push([command, args]);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
  const harness = new FunctionalComposeHarness({
    composeFiles: ['docker-compose.real-backend-smoke.yml'],
    projectName: 'fci-test-project',
    spawnImpl
  });
  harness.composeInvocation = composeV2Invocation;

  await Promise.all([harness.cleanup(), harness.cleanup()]);

  assert.deepEqual(calls, [[
    'docker',
    [
      'compose',
      '-p', 'fci-test-project',
      '-f', 'docker-compose.real-backend-smoke.yml',
      'down', '--volumes', '--remove-orphans'
    ]
  ]]);
});
