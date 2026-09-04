import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFunctionalTags } from '../../scripts/ci/functional-tags.mjs';
import { functionalMetadata } from './fixtures/functional-metadata.mjs';

test('emits explicit gate/domain/ownership tags and annotations', () => {
  const details = functionalMetadata({
    journeyId: 'FUNC-TASK-001',
    gates: ['functional-fast', 'functional-full'],
    domains: ['task'],
    priority: 'p0',
    backend: 'real',
    polarity: 'positive'
  });

  assert.deepEqual(details.tag, [
    '@functional',
    '@functional-fast',
    '@functional-full',
    '@task',
    '@p0',
    '@real-backend',
    '@positive',
    '@journey-FUNC-TASK-001'
  ]);
  assert.equal(details.annotation.find((entry) => entry.type === 'journey')?.description, 'FUNC-TASK-001');
  assert.equal(details.annotation.find((entry) => entry.type === 'backend')?.description, 'real');
});

test('adds authorization-negative and release evidence tags deliberately', () => {
  const details = functionalMetadata({
    journeyId: 'FUNC-AUTHZ-001',
    gates: ['functional-full', 'functional-release'],
    domains: ['security-negative'],
    priority: 'p0',
    backend: 'real',
    polarity: 'negative',
    negativeAuthz: true
  });

  assert.equal(details.tag.includes('@negative-authz'), true);
  assert.equal(details.tag.includes('@release-evidence'), true);
  assert.equal(details.tag.includes('@functional-release'), true);
});

test('rejects incomplete or contradictory ownership metadata', () => {
  assert.throws(
    () =>
      functionalMetadata({
        journeyId: 'FUNC-AUTHZ-001',
        gates: ['functional-fast'],
        domains: ['security-negative'],
        priority: 'p0',
        backend: 'real',
        polarity: 'positive'
      }),
    /security-negative domain requires polarity="negative"/u
  );

  assert.throws(
    () =>
      functionalMetadata({
        journeyId: 'bad-id',
        gates: ['functional-fast'],
        domains: ['task'],
        priority: 'p0',
        backend: 'real',
        polarity: 'positive'
      }),
    /Invalid Functional Journey ID/u
  );
});

test('buildFunctionalTags cannot bypass required metadata validation', () => {
  assert.throws(
    () =>
      buildFunctionalTags({
        journeyId: 'FUNC-TASK-001',
        gates: ['functional-fast'],
        domains: ['task']
      }),
    /Invalid Functional priority/u
  );

  assert.throws(
    () =>
      buildFunctionalTags({
        journeyId: 'FUNC-TASK-001',
        gates: ['functional-fast'],
        domains: ['task'],
        priority: 'p0',
        backend: 'unexpected',
        polarity: 'positive'
      }),
    /Invalid Functional backend/u
  );
});
