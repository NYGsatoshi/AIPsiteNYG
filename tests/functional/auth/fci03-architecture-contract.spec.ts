import { expect, test } from '@playwright/test';

import { functionalMetadata } from '../fixtures/functional-metadata.mjs';

// FCI-03 architecture contract only. This spec proves that repository-owned
// metadata is consumed by a real Playwright spec/config/discovery path. It is
// deliberately classified as mock-backend so the normal Functional runner,
// which defaults to real-backend, cannot count it as owner journey evidence.
test(
  'FCI-03 discovers FUNC-AUTH-001 metadata without claiming real-backend coverage',
  functionalMetadata({
    journeyId: 'FUNC-AUTH-001',
    gates: ['functional-fast'],
    domains: ['auth'],
    priority: 'p0',
    backend: 'mock',
    polarity: 'positive'
  }),
  () => {
    expect(true).toBe(true);
  }
);
