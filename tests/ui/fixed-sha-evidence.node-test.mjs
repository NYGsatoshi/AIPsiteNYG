import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDetachedFixedSha } from './fixed-sha-evidence.mjs';

const CHECKOUT_SHA = 'a'.repeat(40);
const DIFFERENT_SHA = 'b'.repeat(40);

test('accepts a detached checkout SHA that exactly matches GITHUB_SHA', () => {
  assert.equal(validateDetachedFixedSha(`${CHECKOUT_SHA}\n`, CHECKOUT_SHA, 'Issue #683 evidence'), CHECKOUT_SHA);
});

test('rejects symbolic HEAD instead of resolving it through an executable lookup', () => {
  assert.throws(
    () => validateDetachedFixedSha('ref: refs/heads/main\n', CHECKOUT_SHA, 'Issue #683 evidence'),
    /requires a detached full 40-hex checkout SHA/u
  );
});

test('rejects malformed workflow SHA', () => {
  assert.throws(
    () => validateDetachedFixedSha(CHECKOUT_SHA, 'main', 'Issue #683 evidence'),
    /requires GITHUB_SHA to be a full 40-hex SHA/u
  );
});

test('rejects a detached checkout that does not match GITHUB_SHA', () => {
  assert.throws(
    () => validateDetachedFixedSha(CHECKOUT_SHA, DIFFERENT_SHA, 'Issue #683 evidence'),
    /fixed-SHA mismatch/u
  );
});
