import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedArtifactJson, redactForArtifact, redactText } from './helpers/redaction.mjs';

test('redacts sensitive object keys recursively', () => {
  const redacted = redactForArtifact({
    authorization: 'Bearer abc.def',
    nested: {
      password: 'secret-password',
      safe: 'visible'
    },
    rows: [{ storageKey: 'bucket/object', name: 'document.txt' }]
  });

  assert.deepEqual(redacted, {
    authorization: '[REDACTED]',
    nested: { password: '[REDACTED]', safe: 'visible' },
    rows: [{ storageKey: '[REDACTED]', name: 'document.txt' }]
  });
});

test('redacts bearer credentials and sensitive query material from free text', () => {
  const value = redactText(
    'Authorization: Bearer abc.def token=top-secret https://example.test/path?token=query-secret&x=1'
  );
  assert.equal(value.includes('abc.def'), false);
  assert.equal(value.includes('top-secret'), false);
  assert.equal(value.includes('query-secret'), false);
});

test('bounds artifact JSON output', () => {
  const output = boundedArtifactJson({ safe: 'x'.repeat(5000) }, 128);
  assert.equal(output.endsWith('…[TRUNCATED]'), true);
  assert.equal(output.length < 200, true);
});
