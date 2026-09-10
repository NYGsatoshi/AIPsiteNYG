function sameFailure(left, right) {
  return left.method === right.method && left.path === right.path && left.status === right.status;
}

export function isExpectedFailure(failure) {
  return (
    (failure.method === 'POST' && failure.path === '/api/auth/change-password' && failure.status === 403) ||
    (failure.method === 'POST' && failure.path === '/api/auth/change-password' && failure.status === 400) ||
    (failure.method === 'GET' && failure.path === '/api/auth/me' && failure.status === 401) ||
    (failure.method === 'GET' && failure.path === '/api/projects' && failure.status === 401) ||
    (failure.method === 'GET' && failure.path === '/api/me/tasks' && failure.status === 400) ||
    (failure.method === 'GET' && failure.path === '/api/me/tasks' && failure.status === 403) ||
    (failure.method === 'GET' && failure.path === '/api/me/tasks/counts' && failure.status === 403) ||
    (failure.method === 'POST' && /^\/api\/tasks\/[0-9a-f-]+\/kanban-move$/i.test(failure.path) && failure.status === 409) ||
    (failure.method === 'GET' && /^\/api\/projects\/[0-9a-f-]+\/kanban$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'PATCH' && /^\/api\/tasks\/[0-9a-f-]+\/(?:schedule|progress)$/i.test(failure.path) && failure.status === 409) ||
    (failure.method === 'GET' && /^\/api\/projects\/[0-9a-f-]+\/gantt$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'GET' && /^\/api\/tasks\/[0-9a-f-]+$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'POST' && /^\/api\/attachments\/[0-9a-f-]+\/download-grants$/i.test(failure.path) && failure.status === 404) ||
    (failure.method === 'GET' && /^\/api\/attachments\/[0-9a-f-]+\/download$/i.test(failure.path) && failure.status === 400) ||
    (failure.method === 'POST' && /^\/api\/attachment-download-grants\/[0-9a-f-]+\/download$/i.test(failure.path) && failure.status === 400)
  );
}

export function selectPr03cExpectedRevocationRefreshFailures(
  evidence,
  postRevocationFailureStart,
  taskId,
) {
  return evidence.failedApiResponses
    .slice(postRevocationFailureStart)
    .filter((failure) => {
      const method = failure.method.toUpperCase();
      const { pathname } = new URL(failure.path, 'http://localhost');
      const staleProjectTaskList =
        failure.status === 400 &&
        method === 'GET' &&
        /^\/api\/projects\/[^/]+\/tasks$/u.test(pathname);
      const revokedTaskExecutionScope =
        failure.status === 404 &&
        method === 'GET' &&
        pathname === `/api/tasks/${taskId}/execution-scope`;
      return staleProjectTaskList || revokedTaskExecutionScope;
    });
}

export function classifyUnexpectedApiFailures(
  evidence,
  scenarioExpectedFailures = [],
) {
  const remainingScenarioExpected = [...scenarioExpectedFailures];
  const unexpected = evidence.failedApiResponses.filter((failure) => {
    if (isExpectedFailure(failure)) {
      return false;
    }
    const expectedIndex = remainingScenarioExpected.findIndex((expected) =>
      sameFailure(failure, expected),
    );
    if (expectedIndex < 0) {
      return true;
    }
    remainingScenarioExpected.splice(expectedIndex, 1);
    return false;
  });

  return { unexpected, remainingScenarioExpected };
}

export function classifyUnexpectedConsoleErrors(
  evidence,
  scenarioExpectedFailures = [],
) {
  const expectedNetworkFailures = new Map();
  const remainingScenarioExpected = [...scenarioExpectedFailures];
  for (const failure of evidence.failedApiResponses) {
    let expected = isExpectedFailure(failure);
    if (!expected) {
      const expectedIndex = remainingScenarioExpected.findIndex((candidate) =>
        sameFailure(failure, candidate),
      );
      if (expectedIndex >= 0) {
        remainingScenarioExpected.splice(expectedIndex, 1);
        expected = true;
      }
    }
    if (!expected) {
      continue;
    }
    expectedNetworkFailures.set(
      failure.status,
      (expectedNetworkFailures.get(failure.status) ?? 0) + 1,
    );
  }

  return evidence.consoleErrors.filter((message) => {
    const match = /Failed to load resource:.*status of (\d{3})/i.exec(message);
    if (!match) {
      return true;
    }
    const status = Number(match[1]);
    const remaining = expectedNetworkFailures.get(status) ?? 0;
    if (remaining === 0) {
      return true;
    }
    expectedNetworkFailures.set(status, remaining - 1);
    return false;
  });
}
