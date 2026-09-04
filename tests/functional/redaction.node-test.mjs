import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedArtifactJson, redactForArtifact, redactText } from './helpers/redaction.mjs';

test('redacts sensitive object keys recursively', () => {
  const redacted = redactForArtifact({
    authorization: 'Bearer abc.def',
    nested: {
      password: 'secret-password',
      clientSecret: 'oauth-secret',
      safe: 'visible'
    },
    rows: [{ storageKey: 'bucket/object', signature: 'signed-value', name: 'document.txt' }]
  });

  assert.deepEqual(redacted, {
    authorization: '[REDACTED]',
    nested: { password: '[REDACTED]', clientSecret: '[REDACTED]', safe: 'visible' },
    rows: [{ storageKey: '[REDACTED]', signature: '[REDACTED]', name: 'document.txt' }]
  });
});

test('redacts bearer credentials, cookie headers, OAuth tokens, and signed URL credentials from free text', () => {
  const value = redactText(
    [
      'Authorization: Bearer abc.def',
      'Cookie: session=super-secret-cookie; csrftoken=csrf-value',
      'access_token=oauth-access refresh_token=oauth-refresh id_token=oauth-id client_secret=client-secret',
      'https://s3.example.test/object?X-Amz-Credential=AKIAEXAMPLE%2Fscope&X-Amz-Signature=abcdef&X-Amz-Security-Token=session-token',
      'https://blob.example.test/object?sv=2026-01-01&sig=azure-signature',
      'https://storage.example.test/object?X-Goog-Credential=service%40example.test%2Fscope&X-Goog-Signature=goog-signature',
      'https://user:password@example.test/private'
    ].join('\n')
  );

  for (const secret of [
    'abc.def',
    'super-secret-cookie',
    'csrf-value',
    'oauth-access',
    'oauth-refresh',
    'oauth-id',
    'client-secret',
    'AKIAEXAMPLE',
    'abcdef',
    'session-token',
    'azure-signature',
    'service%40example.test',
    'goog-signature',
    'user:password'
  ]) {
    assert.equal(value.includes(secret), false, `expected ${secret} to be redacted`);
  }

  assert.equal(value.includes('sv=2026-01-01'), true);
  assert.equal(value.includes('[REDACTED]'), true);
});

test('bounds artifact JSON output', () => {
  const output = boundedArtifactJson({ safe: 'x'.repeat(5000) }, 128);
  assert.equal(output.endsWith('…[TRUNCATED]'), true);
  assert.equal(output.length < 200, true);
});
