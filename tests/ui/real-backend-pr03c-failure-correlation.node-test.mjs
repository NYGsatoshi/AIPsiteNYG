import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const MISSING_BOUNDARY = -1;
const FIRST_INDEX = 0;
const NO_FAILURES = 0;
const ONE_FAILURE = 1;
const TWO_FAILURES = 2;
const THREE_FAILURES = 3;
const VM_TIMEOUT_MS = 1_000;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;

// Exercise the actual inline PR03C selector and shared assertion helpers without
// Importing the Playwright suite (which requires a seeded, licensed backend).
// This is a classifier regression test, not real-backend acceptance evidence.
const source = readFileSync(new URL('./real-backend-smoke.spec.ts', import.meta.url), 'utf8');

function between(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, MISSING_BOUNDARY, `Missing source boundary: ${start}`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, MISSING_BOUNDARY, `Missing source boundary: ${end}`);
  return text.slice(startIndex, endIndex);
}

const scenario = between(source, "  test('TASK-V1-PR03C uses the real backend", '\n  });');
const selector = between(
  scenario,
  'const expectedRevocationRefreshFailures =',
  '\n\n      expect(evidence.pageErrors'
);
const helpers = between(
  source,
  'function expectUnexpectedApiFailures(',
  '\nasync function verifyRealtimeRuntimeConfig('
);
const { selectExpected, expectUnexpectedApiFailures, expectUnexpectedConsoleErrors, isExpectedFailure } =
  runInNewContext(`
    ${stripTypeScriptTypes(helpers, { mode: 'strip' })}
    function selectExpected(evidence, postRevocationFailureStart, taskId) {
      ${selector}
      return expectedRevocationRefreshFailures;
    }
    ({ selectExpected, expectUnexpectedApiFailures, expectUnexpectedConsoleErrors, isExpectedFailure });
  `, {
    URL,
    expect(actual, message) {
      return {
        toEqual(expected) {
          // The helpers execute in a separate realm; compare their data, not
          // The realm-specific Array prototypes.
          assert.deepStrictEqual(structuredClone(actual), structuredClone(expected), message);
        }
      };
    }
  }, { timeout: VM_TIMEOUT_MS });

const taskId = '11111111-1111-4111-8111-111111111111';
const otherTaskId = '22222222-2222-4222-8222-222222222222';
const executionScopePath = `/api/tasks/${taskId}/execution-scope`;
const failure = (overrides = {}) => ({ method: 'GET', path: executionScopePath, status: HTTP_NOT_FOUND, ...overrides });
const networkError = (status) => `Failed to load resource: the server responded with a status of ${status} (test)`;
const evidenceFor = (failedApiResponses) => ({
  failedApiResponses,
  consoleErrors: failedApiResponses.map(({ status }) => networkError(status))
});

function expectBothAccept(evidence, expected) {
  assert.doesNotThrow(() => expectUnexpectedApiFailures(evidence, expected));
  assert.doesNotThrow(() => expectUnexpectedConsoleErrors(evidence, expected));
}

function expectBothReject(evidence, expected) {
  assert.throws(() => expectUnexpectedApiFailures(evidence, expected), /unexpected failed API responses/);
  assert.throws(() => expectUnexpectedConsoleErrors(evidence, expected), /unexpected browser console errors/);
}

test('PR03C captures its boundary before revocation and asserts success before consuming failures', () => {
  const boundary = scenario.indexOf('const postRevocationFailureStart = evidence.failedApiResponses.length;');
  const revoke = scenario.indexOf("const removeMembership = await requestWithCsrf(page, 'DELETE'");
  const success = scenario.indexOf("expect(removeMembership.status, 'test setup revokes active Workspace access through the real backend').toBe(200);");
  const selection = scenario.indexOf('const expectedRevocationRefreshFailures =');
  assert.ok(boundary >= FIRST_INDEX && boundary < revoke && revoke < success && success < selection);
  assert.match(scenario.slice(selection), /expectUnexpectedConsoleErrors\(evidence, expectedRevocationRefreshFailures\);/u);
  assert.match(scenario.slice(selection), /expectUnexpectedApiFailures\(evidence, expectedRevocationRefreshFailures\);/u);
});

test('exact post-revocation GET execution-scope 404 is shared by both classifiers', () => {
  const evidence = evidenceFor([failure()]);
  const expected = selectExpected(evidence, NO_FAILURES, taskId);
  assert.deepStrictEqual(structuredClone(expected), evidence.failedApiResponses);
  assert.equal(expected[FIRST_INDEX], evidence.failedApiResponses[FIRST_INDEX]);
  Object.freeze(expected);
  expectBothAccept(evidence, expected);
  assert.equal(expected.length, ONE_FAILURE, 'Neither classifier mutates the shared scenario list');
});

test('execution-scope 404 is never added to the global expected-failure classifier', () => {
  assert.equal(isExpectedFailure(failure()), false);
  expectBothReject(evidenceFor([failure()]), []);
});

test('a pre-revocation execution-scope 404 remains unexpected', () => {
  const evidence = evidenceFor([failure()]);
  const expected = selectExpected(evidence, ONE_FAILURE, taskId);
  assert.equal(expected.length, NO_FAILURES);
  expectBothReject(evidence, expected);
});

test('an identical post-revocation tuple cannot hide an earlier unexpected 404', () => {
  const evidence = evidenceFor([failure(), failure()]);
  const expected = selectExpected(evidence, ONE_FAILURE, taskId);
  assert.equal(expected.length, ONE_FAILURE);
  expectBothReject(evidence, expected);
});

for (const [name, path] of [
  ['another Task', `/api/tasks/${otherTaskId}/execution-scope`],
  ['another endpoint', `/api/tasks/${taskId}/activity`],
  ['a suffix', `${executionScopePath}/history`],
  ['a trailing slash', `${executionScopePath}/`],
  ['a similar endpoint', `${executionScopePath}-unexpected`]
]) {
  test(`post-revocation 404 for ${name} remains unexpected`, () => {
    const evidence = evidenceFor([failure({ path })]);
    const expected = selectExpected(evidence, NO_FAILURES, taskId);
    assert.equal(expected.length, NO_FAILURES);
    expectBothReject(evidence, expected);
  });
}

for (const method of ['POST', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS']) {
  test(`post-revocation ${method} execution-scope 404 remains unexpected`, () => {
    const evidence = evidenceFor([failure({ method })]);
    const expected = selectExpected(evidence, NO_FAILURES, taskId);
    assert.equal(expected.length, NO_FAILURES);
    expectBothReject(evidence, expected);
  });
}

for (const status of [
  HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED, HTTP_FORBIDDEN, HTTP_CONFLICT,
  HTTP_TOO_MANY_REQUESTS, HTTP_INTERNAL_SERVER_ERROR, HTTP_SERVICE_UNAVAILABLE
]) {
  test(`post-revocation GET execution-scope ${status} remains unexpected`, () => {
    const evidence = evidenceFor([failure({ status })]);
    const expected = selectExpected(evidence, NO_FAILURES, taskId);
    assert.equal(expected.length, NO_FAILURES);
    expectBothReject(evidence, expected);
  });
}

test('pathname normalization accepts a query without accepting a different path', () => {
  const evidence = evidenceFor([failure({ path: `${executionScopePath}?refresh=1` })]);
  const expected = selectExpected(evidence, NO_FAILURES, taskId);
  assert.equal(expected.length, ONE_FAILURE);
  expectBothAccept(evidence, expected);
});

test('multiple observed post-revocation refreshes retain one-to-one failure budgets', () => {
  const evidence = evidenceFor([failure(), failure(), failure()]);
  const expected = selectExpected(evidence, NO_FAILURES, taskId);
  assert.equal(expected.length, THREE_FAILURES);
  expectBothAccept(evidence, expected);
  evidence.consoleErrors.push(networkError(HTTP_NOT_FOUND));
  assert.throws(() => expectUnexpectedConsoleErrors(evidence, expected), /unexpected browser console errors/);
});

test('non-network console errors are not masked by an expected refresh', () => {
  const evidence = evidenceFor([failure()]);
  const expected = selectExpected(evidence, NO_FAILURES, taskId);
  evidence.consoleErrors.push('Unexpected application error');
  assert.throws(() => expectUnexpectedConsoleErrors(evidence, expected), /unexpected browser console errors/);
});

test('an expected 404 cannot consume a console failure with another status', () => {
  const evidence = evidenceFor([failure()]);
  const expected = selectExpected(evidence, NO_FAILURES, taskId);
  evidence.consoleErrors = [networkError(HTTP_INTERNAL_SERVER_ERROR)];
  assert.throws(() => expectUnexpectedConsoleErrors(evidence, expected), /unexpected browser console errors/);
});

test('an unobserved scenario failure cannot be fabricated to pass the API assertion', () => {
  assert.throws(
    () => expectUnexpectedApiFailures(evidenceFor([]), [failure()]),
    /scenario-expected failed API responses were not observed/
  );
});

test('absence of the optional racing refresh is valid', () => {
  const evidence = evidenceFor([]);
  const expected = selectExpected(evidence, NO_FAILURES, taskId);
  assert.equal(expected.length, NO_FAILURES);
  expectBothAccept(evidence, expected);
});

test('existing post-revocation project task-list 400 correlation is preserved', () => {
  const evidence = evidenceFor([
    failure({ path: `/api/projects/${otherTaskId}/tasks`, status: HTTP_BAD_REQUEST }),
    failure()
  ]);
  const expected = selectExpected(evidence, NO_FAILURES, taskId);
  assert.equal(expected.length, TWO_FAILURES);
  expectBothAccept(evidence, expected);
});
