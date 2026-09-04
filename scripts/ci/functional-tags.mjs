export const FUNCTIONAL_GATES = Object.freeze([
  'functional-fast',
  'functional-full',
  'functional-extended',
  'functional-release'
]);

export const FUNCTIONAL_DOMAINS = Object.freeze([
  'auth',
  'workspace',
  'task',
  'files',
  'messaging',
  'notification',
  'announcement',
  'audit',
  'security-negative'
]);

export const FUNCTIONAL_PRIORITIES = Object.freeze(['p0', 'p1']);
export const FUNCTIONAL_BACKENDS = Object.freeze(['real', 'mock']);
export const FUNCTIONAL_POLARITIES = Object.freeze(['positive', 'negative']);

const JOURNEY_ID_PATTERN = /^FUNC-[A-Z][A-Z0-9-]*-\d{3}$/u;

const GATE_TAGS = Object.freeze({
  'functional-fast': '@functional-fast',
  'functional-full': '@functional-full',
  'functional-extended': '@functional-extended',
  'functional-release': '@functional-release'
});

const DOMAIN_TAGS = Object.freeze({
  auth: '@auth',
  workspace: '@workspace',
  task: '@task',
  files: '@files',
  messaging: '@messaging',
  notification: '@notification',
  announcement: '@announcement',
  audit: '@audit',
  'security-negative': '@security-negative'
});

/**
 * @param {unknown} input
 * @returns {{
 *   journeyId: string,
 *   gates: string[],
 *   domains: string[],
 *   priority: string,
 *   backend: string,
 *   polarity: string,
 *   negativeAuthz: boolean,
 *   releaseEvidence: boolean
 * }}
 */
export function normalizeFunctionalMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Functional test metadata must be an object.');
  }

  const metadata = /** @type {Record<string, unknown>} */ (input);
  const journeyId = requiredJourneyId(metadata.journeyId);
  const gates = requiredChoices('gates', metadata.gates, FUNCTIONAL_GATES);
  const domains = requiredChoices('domains', metadata.domains, FUNCTIONAL_DOMAINS);
  const priority = requiredChoice('priority', metadata.priority, FUNCTIONAL_PRIORITIES);
  const backend = requiredChoice('backend', metadata.backend, FUNCTIONAL_BACKENDS);
  const polarity = requiredChoice('polarity', metadata.polarity, FUNCTIONAL_POLARITIES);
  const negativeAuthz = metadata.negativeAuthz === true;
  const releaseEvidence = metadata.releaseEvidence === true;

  if (negativeAuthz && polarity !== 'negative') {
    throw new Error('negativeAuthz metadata requires polarity="negative".');
  }

  if (domains.includes('security-negative') && polarity !== 'negative') {
    throw new Error('security-negative domain requires polarity="negative".');
  }

  return {
    journeyId,
    gates,
    domains,
    priority,
    backend,
    polarity,
    negativeAuthz,
    releaseEvidence
  };
}

/**
 * Build Playwright tags from repository-owned Functional metadata.
 *
 * Always normalize here even when a caller believes the object is already
 * normalized. This is a CI taxonomy boundary: exported helpers must fail
 * closed when required ownership/classification fields are missing or invalid.
 *
 * @param {unknown} input
 * @returns {string[]}
 */
export function buildFunctionalTags(input) {
  const metadata = normalizeFunctionalMetadata(input);
  const tags = new Set(['@functional']);

  for (const gate of metadata.gates) {
    tags.add(tagForGate(gate));
  }
  for (const domain of metadata.domains) {
    tags.add(tagForDomain(domain));
  }

  tags.add(`@${metadata.priority}`);
  tags.add(metadata.backend === 'real' ? '@real-backend' : '@mock-backend');
  tags.add(metadata.polarity === 'positive' ? '@positive' : '@negative');
  tags.add(journeyTag(metadata.journeyId));

  if (metadata.negativeAuthz) {
    tags.add('@negative-authz');
  }
  if (metadata.releaseEvidence || metadata.gates.includes('functional-release')) {
    tags.add('@release-evidence');
  }

  return [...tags];
}

export function journeyTag(journeyId) {
  return `@journey-${requiredJourneyId(journeyId)}`;
}

export function tagForGate(gate) {
  return GATE_TAGS[requiredChoice('gate', gate, FUNCTIONAL_GATES)];
}

export function tagForDomain(domain) {
  return DOMAIN_TAGS[requiredChoice('domain', domain, FUNCTIONAL_DOMAINS)];
}

export function assertJourneyId(journeyId) {
  return requiredJourneyId(journeyId);
}

function requiredJourneyId(value) {
  if (typeof value !== 'string' || !JOURNEY_ID_PATTERN.test(value)) {
    throw new Error(`Invalid Functional Journey ID: ${JSON.stringify(value)}. Expected FUNC-<DOMAIN>-NNN.`);
  }
  return value;
}

function requiredChoices(label, value, allowed) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Functional metadata '${label}' must be a non-empty array.`);
  }

  const normalized = [...new Set(value.map((item) => requiredChoice(label, item, allowed)))];
  return normalized;
}

function requiredChoice(label, value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(
      `Invalid Functional ${label}: ${JSON.stringify(value)}. Allowed values: ${allowed.join(', ')}.`
    );
  }
  return value;
}
