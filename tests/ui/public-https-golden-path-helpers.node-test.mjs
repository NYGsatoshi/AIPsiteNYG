import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isUuid,
  publicHttpsOrigin,
  readPublicHttpsSmokeConfiguration
} from './public-https-golden-path-helpers.mjs';

const fixtureIds = {
  AIP_PUBLIC_SMOKE_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
  AIP_PUBLIC_SMOKE_PROJECT_ID: '22222222-2222-4222-8222-222222222222',
  AIP_PUBLIC_SMOKE_TASK_ID: '33333333-3333-4333-8333-333333333333',
  AIP_PUBLIC_SMOKE_UNAUTHORIZED_WORKSPACE_ID: '44444444-4444-4444-8444-444444444444',
  AIP_PUBLIC_SMOKE_UNAUTHORIZED_PROJECT_ID: '55555555-5555-4555-8555-555555555555',
  AIP_PUBLIC_SMOKE_UNAUTHORIZED_TASK_ID: '66666666-6666-4666-8666-666666666666',
  AIP_PUBLIC_SMOKE_REVOKED_FILE_ID: '77777777-7777-4777-8777-777777777777'
};

function environment(overrides = {}) {
  return {
    AIP_PUBLIC_HTTPS_SMOKE: '1',
    AIP_PUBLIC_SMOKE_SYNTHETIC_FIXTURE: '1',
    AIP_PUBLIC_SMOKE_URL: 'https://portal.example.com',
    AIP_PUBLIC_SMOKE_EMAIL: 'release-gate@example.test',
    AIP_PUBLIC_SMOKE_PASSWORD: 'synthetic-test-password',
    ...fixtureIds,
    ...overrides
  };
}

test('accepts a public HTTPS origin and a complete dedicated synthetic fixture', () => {
  const configuration = readPublicHttpsSmokeConfiguration(environment());

  assert.equal(configuration.baseURL, 'https://portal.example.com');
  assert.equal(configuration.email, 'release-gate@example.test');
  assert.equal(isUuid(configuration.taskId), true);
});

test('rejects local, private, credentialed, and non-HTTPS endpoints', () => {
  for (const value of [
    'http://portal.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.4',
    'https://user:password@portal.example.com',
    'https://portal.example.com/app',
    'https://portal.example.com:8443'
  ]) {
    assert.throws(() => publicHttpsOrigin(value));
  }
});

test('fails closed when a gate marker, synthetic account, or fixture identifier is missing', () => {
  assert.throws(
    () => readPublicHttpsSmokeConfiguration(environment({ AIP_PUBLIC_HTTPS_SMOKE: '0' })),
    /AIP_PUBLIC_HTTPS_SMOKE=1/
  );
  assert.throws(
    () => readPublicHttpsSmokeConfiguration(environment({ AIP_PUBLIC_SMOKE_EMAIL: 'operator@example.com' })),
    /synthetic @example\.test/
  );
  assert.throws(
    () => readPublicHttpsSmokeConfiguration(environment({ AIP_PUBLIC_SMOKE_TASK_ID: 'not-a-uuid' })),
    /AIP_PUBLIC_SMOKE_TASK_ID/
  );
});
