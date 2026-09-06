import assert from 'node:assert/strict';
import test from 'node:test';

import {
  functionalFullExpansionEnabled,
  selectedFunctionalGates
} from './fixtures/functional-gate-selection.mjs';

test('keeps functional-fast bounded while full and extended select the expansion', () => {
  assert.equal(functionalFullExpansionEnabled('functional-fast'), false);
  assert.equal(functionalFullExpansionEnabled('functional-full'), true);
  assert.equal(functionalFullExpansionEnabled('functional-extended'), true);
  assert.equal(functionalFullExpansionEnabled('functional-release'), true);
  assert.equal(functionalFullExpansionEnabled('functional-fast,functional-full'), true);
});

test('runs the complete owner path for direct unscoped journey execution', () => {
  assert.deepEqual(selectedFunctionalGates(''), []);
  assert.equal(functionalFullExpansionEnabled(''), true);
  assert.deepEqual(
    selectedFunctionalGates(' functional-full,functional-full, functional-extended '),
    ['functional-full', 'functional-extended']
  );
  assert.throws(
    () => functionalFullExpansionEnabled('functional-fastish'),
    /Unknown Functional gate selection/u
  );
});
