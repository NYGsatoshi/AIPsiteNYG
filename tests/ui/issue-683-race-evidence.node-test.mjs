import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ISSUE_683_ITERATION_COUNT,
  ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS,
  ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT,
  ISSUE_683_RETRY_ARGUMENT,
  isIssue683RaceObservation,
  issue683RaceObservations,
  summarizeIssue683Iterations,
  validateIssue683RetryArguments
} from './issue-683-race-evidence.mjs';

const HTTP_NOT_FOUND_STATUS = 404;
const HTTP_BAD_REQUEST_STATUS = 400;
const ZERO_RACE_OBSERVATIONS = 0;
const ONE_RACE_OBSERVATION = 1;
const NON_ZERO_RETRY_COUNT = ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT + 1;
const PR03C_RESULT_COUNT = 1;
const SUCCESS_EXIT_CODE = 0;
const RACE_PATH = '/api/tasks/11111111-1111-1111-1111-111111111111/execution-scope';

test('Issue #683 policy is version-controlled as ten clean iterations with at least one race observation and zero retries', () => {
  assert.equal(ISSUE_683_ITERATION_COUNT, 10);
  assert.equal(ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS, ONE_RACE_OBSERVATION);
  assert.equal(ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT, SUCCESS_EXIT_CODE);
  assert.equal(ISSUE_683_RETRY_ARGUMENT, '--retries=0');
});

test('Issue #683 race matcher accepts only the exact GET task execution-scope 404 boundary', () => {
  assert.equal(
    isIssue683RaceObservation({ method: 'GET', path: RACE_PATH, status: HTTP_NOT_FOUND_STATUS }),
    true
  );
  assert.equal(
    isIssue683RaceObservation({ method: 'POST', path: RACE_PATH, status: HTTP_NOT_FOUND_STATUS }),
    false
  );
  assert.equal(
    isIssue683RaceObservation({ method: 'GET', path: RACE_PATH, status: HTTP_BAD_REQUEST_STATUS }),
    false
  );
  assert.equal(
    isIssue683RaceObservation({ method: 'GET', path: '/api/tasks/execution-scope', status: HTTP_NOT_FOUND_STATUS }),
    false
  );
});

test('Issue #683 evidence extraction returns only matching race observations', () => {
  const observations = issue683RaceObservations({
    failedApiResponses: [
      { method: 'GET', path: RACE_PATH, status: HTTP_NOT_FOUND_STATUS },
      { method: 'GET', path: '/api/projects/example/tasks', status: HTTP_BAD_REQUEST_STATUS }
    ]
  });

  assert.deepEqual(observations, [
    { method: 'GET', path: RACE_PATH, status: HTTP_NOT_FOUND_STATUS }
  ]);
});

test('Issue #683 retry validator rejects retry overrides even when retries=0 is also present', () => {
  assert.doesNotThrow(() => validateIssue683RetryArguments([ISSUE_683_RETRY_ARGUMENT]));
  assert.throws(
    () => validateIssue683RetryArguments([ISSUE_683_RETRY_ARGUMENT, `--retries=${NON_ZERO_RETRY_COUNT}`]),
    /requires exactly one --retries=0 argument/
  );
});

test('Issue #683 summary requires every iteration to pass and the race to be observed', () => {
  const iterations = passingIterations();
  iterations[0].raceObservationCount = ONE_RACE_OBSERVATION;

  const summary = summarizeIssue683Iterations(iterations);

  assert.equal(summary.allIterationsPassed, true);
  assert.equal(summary.raceConditionSatisfied, true);
  assert.equal(summary.accepted, true);
});

test('Issue #683 summary rejects ten clean iterations when the race was never observed', () => {
  const summary = summarizeIssue683Iterations(passingIterations());

  assert.equal(summary.raceObservedIterations, ZERO_RACE_OBSERVATIONS);
  assert.equal(summary.raceConditionSatisfied, false);
  assert.equal(summary.accepted, false);
});

test('Issue #683 summary rejects any Playwright retry', () => {
  const iterations = passingIterations();
  iterations[0].raceObservationCount = ONE_RACE_OBSERVATION;
  iterations[0].pr03cRetries = [NON_ZERO_RETRY_COUNT];

  const summary = summarizeIssue683Iterations(iterations);

  assert.equal(summary.allIterationsPassed, false);
  assert.equal(summary.accepted, false);
});

function passingIterations() {
  return Array.from({ length: ISSUE_683_ITERATION_COUNT }, (_, index) => ({
    iteration: index + PR03C_RESULT_COUNT,
    exitCode: SUCCESS_EXIT_CODE,
    pr03cResultCount: PR03C_RESULT_COUNT,
    pr03cRetries: [ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT],
    pr03cStatuses: ['passed'],
    parseErrors: [],
    raceObservationCount: ZERO_RACE_OBSERVATIONS
  }));
}
