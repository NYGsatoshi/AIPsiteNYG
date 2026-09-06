import {
  ISSUE_683_ITERATION_COUNT,
  ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS,
  ISSUE_683_PASSED_STATUS,
  ISSUE_683_REQUIRED_EXIT_CODE,
  ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT,
  ISSUE_683_REQUIRED_PR03C_RESULT_COUNT,
  isIssue683RaceObservation,
  issue683RaceObservations,
  summarizeIssue683Iterations
} from './issue-683-race-evidence.mjs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const EXPECTED_ITERATION_COUNT = 10,
  FIRST_ARRAY_INDEX = 0,
  FIRST_ITERATION_NUMBER = 1,
  HTTP_BAD_REQUEST_STATUS = 400,
  HTTP_NOT_FOUND_STATUS = 404,
  HTTP_OK_STATUS = 200,
  NON_ZERO_RETRY_COUNT = 1,
  ONE_RACE_OBSERVATION = 1,
  RACE_PATH = '/api/tasks/11111111-1111-1111-1111-111111111111/execution-scope',
  REVOCATION_PATH = '/api/workspaces/22222222-2222-2222-2222-222222222222/members/33333333-3333-3333-3333-333333333333',
  REVOCATION_STEP_NAME = 'pr03c-workspace-membership-revoked',
  ZERO_RACE_OBSERVATIONS = 0,
  /**
   * Generate an array of passing iteration fixtures for testing.
   * @returns {Array<object>} Array of iteration objects with all passing criteria met except race observations
   */
  passingIterations = () =>
    Array.from({ length: ISSUE_683_ITERATION_COUNT }, (_unusedValue, index) => ({
      exitCode: ISSUE_683_REQUIRED_EXIT_CODE,
      iteration: index + FIRST_ITERATION_NUMBER,
      parseErrors: [],
      playwrightRetries: [ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT],
      pr03cResultCount: ISSUE_683_REQUIRED_PR03C_RESULT_COUNT,
      pr03cRetries: [ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT],
      pr03cStatuses: [ISSUE_683_PASSED_STATUS],
      raceObservationCount: ZERO_RACE_OBSERVATIONS
    }));

test('Issue #683 policy fixes ten clean iterations, at least one race observation, and zero Playwright retries', () => {
  assert.equal(ISSUE_683_ITERATION_COUNT, EXPECTED_ITERATION_COUNT);
  assert.equal(ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS, ONE_RACE_OBSERVATION);
  assert.equal(ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT, ZERO_RACE_OBSERVATIONS);
  assert.equal(ISSUE_683_REQUIRED_PR03C_RESULT_COUNT, FIRST_ITERATION_NUMBER);
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
    isIssue683RaceObservation({
      method: 'GET',
      path: '/api/tasks/execution-scope',
      status: HTTP_NOT_FOUND_STATUS
    }),
    false
  );
});

test('Issue #683 does not count a matching 404 without successful Workspace revocation evidence', () => {
  const observations = issue683RaceObservations({
    failedApiResponses: [
      { method: 'GET', path: RACE_PATH, status: HTTP_NOT_FOUND_STATUS }
    ],
    steps: []
  });

  assert.deepEqual(observations, []);
});

test('Issue #683 evidence extraction requires successful revocation and returns only matching race observations', () => {
  const observations = issue683RaceObservations({
    failedApiResponses: [
      { method: 'GET', path: RACE_PATH, status: HTTP_NOT_FOUND_STATUS },
      { method: 'GET', path: '/api/projects/example/tasks', status: HTTP_BAD_REQUEST_STATUS }
    ],
    steps: [
      {
        method: 'DELETE',
        name: REVOCATION_STEP_NAME,
        path: REVOCATION_PATH,
        status: HTTP_OK_STATUS
      }
    ]
  });

  assert.deepEqual(observations, [
    { method: 'GET', path: RACE_PATH, status: HTTP_NOT_FOUND_STATUS }
  ]);
});

test('Issue #683 summary accepts only when every planned iteration passes and the race is observed', () => {
  const iterations = passingIterations();

  iterations[FIRST_ARRAY_INDEX].raceObservationCount = ONE_RACE_OBSERVATION;
  assert.equal(summarizeIssue683Iterations(iterations).allIterationsPassed, true);
  assert.equal(summarizeIssue683Iterations(iterations).raceConditionSatisfied, true);
  assert.equal(summarizeIssue683Iterations(iterations).accepted, true);
});

test('Issue #683 summary rejects clean iterations when the race was never observed', () => {
  const summary = summarizeIssue683Iterations(passingIterations());

  assert.equal(summary.accepted, false);
  assert.equal(summary.raceConditionSatisfied, false);
  assert.equal(summary.raceObservedIterations, ZERO_RACE_OBSERVATIONS);
});

test('Issue #683 summary rejects a passing suite if Playwright actually retried any test', () => {
  const iterations = passingIterations();

  iterations[FIRST_ARRAY_INDEX].raceObservationCount = ONE_RACE_OBSERVATION;
  iterations[FIRST_ARRAY_INDEX].playwrightRetries = [NON_ZERO_RETRY_COUNT];
  assert.equal(summarizeIssue683Iterations(iterations).accepted, false);
  assert.equal(summarizeIssue683Iterations(iterations).allIterationsPassed, false);
});

test('Issue #683 summary rejects an incomplete repeated-run set', () => {
  const iterations = passingIterations();

  iterations.pop();
  iterations[FIRST_ARRAY_INDEX].raceObservationCount = ONE_RACE_OBSERVATION;
  assert.equal(summarizeIssue683Iterations(iterations).accepted, false);
  assert.equal(summarizeIssue683Iterations(iterations).allIterationsPassed, false);
});
