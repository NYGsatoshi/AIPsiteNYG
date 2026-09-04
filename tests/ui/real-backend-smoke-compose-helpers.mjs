// Backward-compatible re-exports for existing real-backend runner/tests.
// New Functional CI lanes should import the shared harness directly.
export {
  buildCanonicalFunctionalFixtureEnvironment,
  canonicalFunctionalFixtureAliases,
  composeProjectName,
  composeV2Invocation,
  formatFailureClassification,
  FunctionalComposeHarness,
  FunctionalFailureClassification,
  FunctionalHarnessError,
  getComposeProjectName,
  isHstsPreloadedHttpUrl,
  isStaticAngularServerUrl,
  legacyComposeInvocation,
  normalizeExitCode,
  redactSecrets,
  selectComposeInvocation
} from '../../scripts/ci/functional-compose-harness.mjs';
