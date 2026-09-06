import assert from 'node:assert/strict';
import test from 'node:test';

import {
  functionalRunnerEnvironment,
  parseFunctionalRunnerArguments
} from '../../scripts/ci/run-functional-playwright.mjs';

test('defaults Functional runner to real backend classification', () => {
  const parsed = parseFunctionalRunnerArguments(['--gate', 'functional-fast']);
  assert.deepEqual(parsed.filters.backends, ['real']);
  assert.deepEqual(parsed.filters.gates, ['functional-fast']);
});

test('keeps Playwright arguments behind an explicit separator', () => {
  const parsed = parseFunctionalRunnerArguments([
    '--domain',
    'files',
    '--',
    '--list',
    '--project',
    'functional-chromium'
  ]);
  assert.deepEqual(parsed.playwrightArgs, ['--list', '--project', 'functional-chromium']);
});

test('rejects unknown runner arguments instead of silently forwarding them', () => {
  assert.throws(() => parseFunctionalRunnerArguments(['--list']), /Use -- before Playwright arguments/u);
});

test('passes the selected gates to owner journeys without leaking a stale gate', () => {
  const full = functionalRunnerEnvironment(
    { gates: ['functional-full', 'functional-extended'] },
    { AIP_FUNCTIONAL_SELECTED_GATES: 'functional-fast', SAFE_VALUE: 'kept' }
  );
  assert.equal(full.AIP_FUNCTIONAL_SELECTED_GATES, 'functional-full,functional-extended');
  assert.equal(full.SAFE_VALUE, 'kept');

  const unscoped = functionalRunnerEnvironment({}, { AIP_FUNCTIONAL_SELECTED_GATES: 'functional-fast' });
  assert.equal(unscoped.AIP_FUNCTIONAL_SELECTED_GATES, '');
});
