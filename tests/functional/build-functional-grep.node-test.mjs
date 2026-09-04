import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFunctionalGrep,
  parseFunctionalGrepArguments
} from '../../scripts/ci/build-functional-grep.mjs';

const realFastTaskTitle =
  'functional-chromium project-task/golden.spec.ts persists task ' +
  '@functional @functional-fast @functional-full @p0 @task @real-backend @positive @journey-FUNC-TASK-001';

test('builds exact metadata-tag selection for gate/domain/priority/backend/journey', () => {
  const grep = buildFunctionalGrep({
    gates: ['functional-fast'],
    domains: ['task'],
    priorities: ['p0'],
    backends: ['real'],
    journeys: ['FUNC-TASK-001']
  });
  const pattern = new RegExp(grep, 'u');

  assert.equal(pattern.test(realFastTaskTitle), true);
  assert.equal(pattern.test(realFastTaskTitle.replace('@task ', '@files ')), false);
  assert.equal(pattern.test(realFastTaskTitle.replace('@real-backend', '@mock-backend')), false);
  assert.equal(pattern.test(realFastTaskTitle.replace('@functional-fast', '@functional-fastish')), false);
});

test('ORs repeated values inside a dimension while ANDing dimensions', () => {
  const pattern = new RegExp(
    buildFunctionalGrep({ gates: 'functional-full', domains: ['task', 'files'], priorities: 'p0' }),
    'u'
  );

  assert.equal(pattern.test(realFastTaskTitle), true);
  assert.equal(pattern.test(realFastTaskTitle.replace('@task', '@files')), true);
  assert.equal(pattern.test(realFastTaskTitle.replace('@task', '@messaging')), false);
  assert.equal(pattern.test(realFastTaskTitle.replace('@p0', '@p1')), false);
});

test('supports negative authorization and release evidence selectors', () => {
  const negative =
    'functional-chromium security-negative/denial.spec.ts deny cross scope ' +
    '@functional @functional-full @p0 @security-negative @real-backend @negative ' +
    '@negative-authz @release-evidence @journey-FUNC-AUTHZ-001';
  const pattern = new RegExp(
    buildFunctionalGrep({ negativeAuthz: true, releaseEvidence: true, journeys: 'FUNC-AUTHZ-001' }),
    'u'
  );

  assert.equal(pattern.test(negative), true);
  assert.equal(pattern.test(negative.replace('@negative-authz', '@negative-authz-extra')), false);
});

test('parses repeated and comma-separated CLI filters', () => {
  const filters = parseFunctionalGrepArguments([
    '--gate',
    'functional-fast,functional-full',
    '--domain',
    'task',
    '--domain',
    'files',
    '--backend',
    'real'
  ]);

  const pattern = new RegExp(buildFunctionalGrep(filters), 'u');
  assert.equal(pattern.test(realFastTaskTitle), true);
});

test('rejects unknown metadata values and malformed journey IDs', () => {
  assert.throws(() => buildFunctionalGrep({ domains: 'made-up-domain' }), /Invalid Functional domain/u);
  assert.throws(() => buildFunctionalGrep({ journeys: 'TASK-1' }), /Invalid Functional Journey ID/u);
  assert.throws(() => parseFunctionalGrepArguments(['--unknown']), /Unknown Functional grep argument/u);
});
