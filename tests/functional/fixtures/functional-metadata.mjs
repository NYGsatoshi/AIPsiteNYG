import { buildFunctionalTags, normalizeFunctionalMetadata } from '../../../scripts/ci/functional-tags.mjs';

/**
 * Convert repository-owned Functional metadata into Playwright test details.
 * Use as the second argument of test(title, details, body).
 *
 * @param {Record<string, unknown>} metadata
 */
export function functionalMetadata(metadata) {
  const normalized = normalizeFunctionalMetadata(metadata);
  return {
    tag: buildFunctionalTags(normalized),
    annotation: [
      { type: 'journey', description: normalized.journeyId },
      { type: 'functional-gates', description: normalized.gates.join(',') },
      { type: 'functional-domains', description: normalized.domains.join(',') },
      { type: 'priority', description: normalized.priority },
      { type: 'backend', description: normalized.backend },
      { type: 'polarity', description: normalized.polarity }
    ]
  };
}
