export const ISSUE_683_ITERATION_COUNT = 10;
export const ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS = 1;
export const ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT = 0;
export const ISSUE_683_REQUIRED_PR03C_RESULT_COUNT = 1;
export const ISSUE_683_REQUIRED_EXIT_CODE = 0;
export const ISSUE_683_RETRY_ARGUMENT = '--retries=0';
export const ISSUE_683_PR03C_TITLE =
  'TASK-V1-PR03C uses the real backend for task detail, mutations, revocation, and File grant reauthorization';
export const ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT = 'real-backend-smoke-evidence.json';

const ISSUE_683_HTTP_NOT_FOUND_STATUS = 404;
const ISSUE_683_HTTP_GET_METHOD = 'GET';
const ISSUE_683_TASK_EXECUTION_SCOPE_PATH = /^\/api\/tasks\/[^/]+\/execution-scope$/;
const ISSUE_683_PASSED_STATUS = 'passed';

export function isIssue683RaceObservation(failure) {
  if (!failure || typeof failure !== 'object') {
    return false;
  }

  return (
    typeof failure.method === 'string' &&
    failure.method.toUpperCase() === ISSUE_683_HTTP_GET_METHOD &&
    failure.status === ISSUE_683_HTTP_NOT_FOUND_STATUS &&
    typeof failure.path === 'string' &&
    ISSUE_683_TASK_EXECUTION_SCOPE_PATH.test(failure.path)
  );
}

export function issue683RaceObservations(smokeEvidence) {
  const failures = smokeEvidence && typeof smokeEvidence === 'object' && Array.isArray(smokeEvidence.failedApiResponses)
    ? smokeEvidence.failedApiResponses
    : [];
  return failures.filter(isIssue683RaceObservation).map((failure) => ({
    method: failure.method,
    path: failure.path,
    status: failure.status
  }));
}

export function validateIssue683RetryArguments(playwrightArgs) {
  const retryArguments = playwrightArgs.filter((argument) =>
    typeof argument === 'string' && argument.startsWith('--retries')
  );
  if (
    retryArguments.length !== ISSUE_683_REQUIRED_PR03C_RESULT_COUNT ||
    retryArguments[0] !== ISSUE_683_RETRY_ARGUMENT
  ) {
    throw new Error(
      `Issue #683 evidence requires exactly one ${ISSUE_683_RETRY_ARGUMENT} argument; received ${JSON.stringify(retryArguments)}.`
    );
  }
}

export function summarizeIssue683Iterations(iterations) {
  const raceObservedIterations = iterations.filter((iteration) => iteration.raceObservationCount > 0).length;
  const allIterationsPassed =
    iterations.length === ISSUE_683_ITERATION_COUNT &&
    iterations.every((iteration) =>
      iteration.exitCode === ISSUE_683_REQUIRED_EXIT_CODE &&
      iteration.pr03cResultCount === ISSUE_683_REQUIRED_PR03C_RESULT_COUNT &&
      iteration.pr03cRetries.length === ISSUE_683_REQUIRED_PR03C_RESULT_COUNT &&
      iteration.pr03cRetries.every((retry) => retry === ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT) &&
      iteration.pr03cStatuses.length === ISSUE_683_REQUIRED_PR03C_RESULT_COUNT &&
      iteration.pr03cStatuses.every((status) => status === ISSUE_683_PASSED_STATUS) &&
      iteration.parseErrors.length === 0
    );
  const raceConditionSatisfied =
    raceObservedIterations >= ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS;

  return {
    plannedIterations: ISSUE_683_ITERATION_COUNT,
    completedIterations: iterations.length,
    requiredPlaywrightRetries: ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT,
    minimumRaceObservationIterations: ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS,
    raceObservedIterations,
    allIterationsPassed,
    raceConditionSatisfied,
    accepted: allIterationsPassed && raceConditionSatisfied
  };
}
