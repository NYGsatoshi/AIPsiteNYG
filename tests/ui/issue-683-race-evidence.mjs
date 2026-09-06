const ISSUE_683_HTTP_DELETE_METHOD = 'DELETE',
  ISSUE_683_HTTP_GET_METHOD = 'GET',
  ISSUE_683_HTTP_NOT_FOUND_STATUS = 404,
  ISSUE_683_HTTP_OK_STATUS = 200,
  ISSUE_683_ITERATION_COUNT = 10,
  ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS = 1,
  ISSUE_683_PASSED_STATUS = 'passed',
  ISSUE_683_PR03C_TITLE =
    'TASK-V1-PR03C uses the real backend for task detail, mutations, revocation, and File grant reauthorization',
  ISSUE_683_REQUIRED_EXIT_CODE = 0,
  ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT = 0,
  ISSUE_683_REQUIRED_PR03C_RESULT_COUNT = 1,
  ISSUE_683_REVOCATION_STEP_NAME = 'pr03c-workspace-membership-revoked',
  ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT = 'task-v1-pr03c-real-backend-evidence.json',
  ISSUE_683_TASK_EXECUTION_SCOPE_PATH = /^\/api\/tasks\/[^/]+\/execution-scope$/u,
  ISSUE_683_WORKSPACE_MEMBERSHIP_PATH = /^\/api\/workspaces\/[^/]+\/members\/[^/]+$/u,
  ZERO_COUNT = 0,
  hasSuccessfulIssue683Revocation = (smokeEvidence) =>
    Array.isArray(smokeEvidence?.steps) &&
    smokeEvidence.steps.some(
      (step) =>
        step &&
        typeof step === 'object' &&
        step.name === ISSUE_683_REVOCATION_STEP_NAME &&
        typeof step.method === 'string' &&
        step.method.toUpperCase() === ISSUE_683_HTTP_DELETE_METHOD &&
        typeof step.path === 'string' &&
        ISSUE_683_WORKSPACE_MEMBERSHIP_PATH.test(step.path) &&
        step.status === ISSUE_683_HTTP_OK_STATUS
    ),
  isIssue683RaceObservation = (failure) => {
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
  },
  isPassingIssue683Iteration = (iteration) => {
    const hasPlaywrightResults = iteration.playwrightRetries.length > ZERO_COUNT;

    return (
      iteration.exitCode === ISSUE_683_REQUIRED_EXIT_CODE &&
      hasPlaywrightResults &&
      iteration.playwrightRetries.every(
        (retry) => retry === ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT
      ) &&
      iteration.pr03cResultCount === ISSUE_683_REQUIRED_PR03C_RESULT_COUNT &&
      iteration.pr03cRetries.length === ISSUE_683_REQUIRED_PR03C_RESULT_COUNT &&
      iteration.pr03cRetries.every(
        (retry) => retry === ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT
      ) &&
      iteration.pr03cStatuses.length === ISSUE_683_REQUIRED_PR03C_RESULT_COUNT &&
      iteration.pr03cStatuses.every((status) => status === ISSUE_683_PASSED_STATUS) &&
      iteration.parseErrors.length === ZERO_COUNT
    );
  },
  issue683RaceObservations = (smokeEvidence) => {
    const failures = [];

    if (!hasSuccessfulIssue683Revocation(smokeEvidence)) {
      return failures;
    }
    if (
      smokeEvidence &&
      typeof smokeEvidence === 'object' &&
      Array.isArray(smokeEvidence.failedApiResponses)
    ) {
      failures.push(...smokeEvidence.failedApiResponses);
    }

    return failures.filter(isIssue683RaceObservation).map((failure) => ({
      method: failure.method,
      path: failure.path,
      status: failure.status
    }));
  },
  summarizeIssue683Iterations = (iterations) => {
    const allIterationsPassed =
        iterations.length === ISSUE_683_ITERATION_COUNT && iterations.every(isPassingIssue683Iteration),
      raceConditionSatisfied =
        iterations.filter((iteration) => iteration.raceObservationCount > ZERO_COUNT).length >=
        ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS,
      raceObservedIterations = iterations.filter(
        (iteration) => iteration.raceObservationCount > ZERO_COUNT
      ).length;

    return {
      accepted: allIterationsPassed && raceConditionSatisfied,
      allIterationsPassed,
      completedIterations: iterations.length,
      minimumRaceObservationIterations: ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS,
      plannedIterations: ISSUE_683_ITERATION_COUNT,
      raceConditionSatisfied,
      raceObservedIterations,
      requiredPlaywrightRetries: ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT
    };
  };

export {
  ISSUE_683_ITERATION_COUNT,
  ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS,
  ISSUE_683_PASSED_STATUS,
  ISSUE_683_PR03C_TITLE,
  ISSUE_683_REQUIRED_EXIT_CODE,
  ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT,
  ISSUE_683_REQUIRED_PR03C_RESULT_COUNT,
  ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT,
  isIssue683RaceObservation,
  isPassingIssue683Iteration,
  issue683RaceObservations,
  summarizeIssue683Iterations
};
