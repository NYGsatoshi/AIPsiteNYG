const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;

export const validateDetachedFixedSha = (detachedHead, workflowSha, evidenceLabel = 'Fixed-SHA evidence') => {
  const actualSha = String(detachedHead ?? '').trim(),
    expectedSha = String(workflowSha ?? '').trim();

  if (!FULL_COMMIT_SHA.test(actualSha)) {
    throw new Error(`${evidenceLabel} requires a detached full 40-hex checkout SHA; received ${actualSha || '<empty>'}.`);
  }
  if (!FULL_COMMIT_SHA.test(expectedSha)) {
    throw new Error(`${evidenceLabel} requires GITHUB_SHA to be a full 40-hex SHA; received ${expectedSha || '<empty>'}.`);
  }
  if (actualSha !== expectedSha) {
    throw new Error(`${evidenceLabel} fixed-SHA mismatch: checkout=${actualSha}, GITHUB_SHA=${expectedSha}.`);
  }

  return actualSha;
};
