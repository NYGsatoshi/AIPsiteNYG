import {
  buildCanonicalFunctionalFixtureEnvironment,
  formatFailureClassification,
  FunctionalComposeHarness,
  FunctionalFailureClassification,
  getComposeProjectName
} from '../../scripts/ci/functional-compose-harness.mjs';

const composeFile = 'docker-compose.real-backend-smoke.yml';
const projectName = getComposeProjectName(process.env, process.pid);
const fixtureEnvironment = buildCanonicalFunctionalFixtureEnvironment(process.env);
const composeEnv = {
  ...process.env,
  ...fixtureEnvironment,
  COMPOSE_PROJECT_NAME: projectName
};
const harness = new FunctionalComposeHarness({
  composeFiles: [composeFile],
  projectName,
  environment: composeEnv,
  diagnosticDirectory: 'test-results',
  diagnosticPrefix: 'functional-real-backend'
});

let signalReceived = false;
process.once('SIGINT', () => void handleSignal('SIGINT', 130));
process.once('SIGTERM', () => void handleSignal('SIGTERM', 143));

process.exitCode = await main();

async function main() {
  let exitCode = 1;
  let setupCompleted = false;

  try {
    const invocation = await harness.initialize();
    console.log(`Using ${invocation.command} ${invocation.prefix.join(' ')} with isolated Functional CI project ${projectName}.`);
    console.log('Functional CI lifecycle: validate-host -> build -> postgres -> migration -> fixture/readiness -> suite -> cleanup.');

    await harness.provisionBaseStack();
    setupCompleted = true;

    const result = await harness.runSuite(realBackendPlaywrightRunArgs());
    exitCode = result.exitCode;
  } catch (error) {
    const phase = error && typeof error === 'object' && 'phase' in error ? String(error.phase) : 'unexpected-setup';
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatFailureClassification(FunctionalFailureClassification.setup, phase, message));
    exitCode = 1;
  } finally {
    if (exitCode !== 0) {
      console.error(`Collecting sanitized Functional CI diagnostics (${setupCompleted ? 'suite started' : 'setup incomplete'}).`);
      try {
        await harness.collectFailureDiagnostics();
      } catch (diagnosticError) {
        const message = diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError);
        console.error(`Sanitized diagnostic collection failed: ${message}`);
      }
    }

    await harness.cleanup();
  }

  return exitCode;
}

function realBackendPlaywrightRunArgs() {
  const args = ['run', '--rm'];
  if (composeEnv.AIP_REAL_BACKEND_P0_SETUP === '1') {
    args.push('--env', 'AIP_REAL_BACKEND_P0_SETUP=1');
  }
  args.push('real-backend-playwright');
  return args;
}

async function handleSignal(signal, exitCode) {
  if (signalReceived) return;
  signalReceived = true;
  console.error(`Received ${signal}; cleaning up isolated Functional CI resources.`);
  await harness.cleanup();
  process.exit(exitCode);
}
