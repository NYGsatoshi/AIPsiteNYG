import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeProjectName,
  composeV2Invocation,
  isHstsPreloadedHttpUrl,
  isStaticAngularServerUrl,
  legacyComposeInvocation,
  normalizeExitCode,
  redactSecrets,
  selectComposeInvocation
} from './real-backend-smoke-compose-helpers.mjs';

test('keeps the legacy real-backend helper shim compatible with shared project naming', () => {
  const name = composeProjectName(['AIP site!', 'RUN/42', 'pid:123', 'x'.repeat(80)]);

  assert.match(name, /^[a-z0-9][a-z0-9_-]*$/);
  assert.ok(name.length <= 63);
  assert.equal(composeProjectName(['---']), 'aipsite-real-backend-smoke');
});

test('prefers Docker Compose v2 when it is available', async () => {
  const calls = [];
  const invocation = await selectComposeInvocation(async (command, args) => {
    calls.push([command, args]);
    return true;
  });

  assert.deepEqual(invocation, composeV2Invocation);
  assert.deepEqual(calls, [['docker', ['compose', 'version']]]);
});

test('falls back to legacy docker-compose when Compose v2 is unavailable', async () => {
  const calls = [];
  const invocation = await selectComposeInvocation(async (command, args) => {
    calls.push([command, args]);
    return command === 'docker-compose';
  });

  assert.deepEqual(invocation, legacyComposeInvocation);
  assert.deepEqual(calls, [
    ['docker', ['compose', 'version']],
    ['docker-compose', ['version']]
  ]);
});

test('reports a classified setup error when neither Compose command is available', async () => {
  await assert.rejects(
    () => selectComposeInvocation(async () => false),
    /Docker Compose is required for Functional CI/
  );
});

test('redacts connection, browser, license, cookie, CSRF, authorization, and invite secrets', () => {
  const redacted = redactSecrets([
    'Password=database-secret;Host=postgres',
    'AIP_BROWSER_SMOKE_PASSWORD: browser-secret',
    'SYNCFUSION_LICENSE: licensed-secret',
    'Authorization: Bearer api-secret',
    'Cookie: session=secret',
    'X-CSRF-Token: csrf-secret',
    'InvitationToken: invite-secret',
    '{"token":"json-secret","password":"json-password"}'
  ].join('\n'));

  for (const secret of ['database-secret', 'browser-secret', 'licensed-secret', 'api-secret', 'session=secret', 'csrf-secret', 'invite-secret', 'json-secret', 'json-password']) {
    assert.doesNotMatch(redacted, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('rejects the static Angular server URL and preserves child exit codes', () => {
  assert.equal(isStaticAngularServerUrl('http://127.0.0.1:4173'), true);
  assert.equal(isStaticAngularServerUrl('http://localhost:4173/app/login'), true);
  assert.equal(isStaticAngularServerUrl('http://aip-backend:8080'), false);
  assert.equal(isHstsPreloadedHttpUrl('http://app:8080'), true);
  assert.equal(isHstsPreloadedHttpUrl('http://service.example.app:8080'), true);
  assert.equal(isHstsPreloadedHttpUrl('https://service.example.app:8080'), false);
  assert.equal(isHstsPreloadedHttpUrl('http://aip-backend:8080'), false);
  assert.equal(normalizeExitCode(37), 37);
  assert.equal(normalizeExitCode(null), 1);
});
