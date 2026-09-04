import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyFunctionalLicensedWorkflow } from '../../scripts/ci/verify-functional-trust-boundary.mjs';

const safeWorkflow = `
on:
  workflow_dispatch:
  push:
    branches: ["main"]
jobs:
  licensed:
    environment: syncfusion-licensed-build
    env:
      SYNCFUSION_LICENSE: \${{ secrets.SYNCFUSION_LICENSE }}
    steps:
      - uses: actions/checkout@v7
        with:
          ref: \${{ github.sha }}
          persist-credentials: false
`;

test('accepts a protected exact-SHA licensed workflow', () => {
  assert.deepEqual(verifyFunctionalLicensedWorkflow(safeWorkflow), []);
});

test('rejects pull_request_target even when other protections are present', () => {
  const unsafe = safeWorkflow.replace('  push:\n', '  pull_request_target:\n  push:\n');
  assert.match(verifyFunctionalLicensedWorkflow(unsafe).join('\n'), /pull_request_target/);
});

test('rejects ordinary pull_request execution in the protected licensed lane', () => {
  const unsafe = safeWorkflow.replace('  push:\n', '  pull_request:\n  push:\n');
  assert.match(verifyFunctionalLicensedWorkflow(unsafe).join('\n'), /pull_request events/);
});

test('rejects checkout of mutable PR refs instead of reviewed github.sha', () => {
  const unsafe = safeWorkflow.replace('ref: \${{ github.sha }}', 'ref: \${{ github.event.pull_request.head.sha }}');
  assert.match(verifyFunctionalLicensedWorkflow(unsafe).join('\n'), /github\.sha/);
});
