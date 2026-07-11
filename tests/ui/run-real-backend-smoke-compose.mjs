import { spawn } from 'node:child_process';

const composeFile = 'docker-compose.real-backend-smoke.yml';
const projectName =
  process.env.REAL_BACKEND_SMOKE_COMPOSE_PROJECT_NAME ??
  composeProjectName([
    'aipsite-real-backend-smoke',
    process.env.GITHUB_RUN_ID,
    process.env.GITHUB_RUN_ATTEMPT,
    process.pid
  ]);
const composeEnv = { ...process.env, COMPOSE_PROJECT_NAME: projectName };
const composeCommand = process.platform === 'win32' ? 'docker-compose' : 'docker';
const composePrefix =
  process.platform === 'win32'
    ? ['-p', projectName, '-f', composeFile]
    : ['compose', '-p', projectName, '-f', composeFile];

let exitCode = 1;

try {
  exitCode = (await runCompose(['config', '--quiet'], { capture: true, redact: true })).exitCode;

  if (exitCode === 0) {
    exitCode = (await runCompose(['up', '--build', '--detach', 'postgres', 'app'])).exitCode;
  }

  if (exitCode === 0) {
    await waitForHealthy('postgres');
    await waitForHealthy('app');
    exitCode = (await runCompose(['run', '--build', '--rm', 'real-backend-playwright'])).exitCode;
  }

  if (exitCode !== 0) {
    await collectFailureEvidence();
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
  await collectFailureEvidence();
} finally {
  await runCompose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
}

process.exit(exitCode);

function composeProjectName(parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part).length > 0)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[^a-z0-9]+/, 'a')
    .slice(0, 63);
}

async function waitForHealthy(service) {
  const deadline = Date.now() + 240_000;
  let lastState = 'unknown';

  while (Date.now() < deadline) {
    const idResult = await runCompose(['ps', '-q', service], { allowFailure: true, capture: true, silent: true });
    const containerId = idResult.output.trim();

    if (containerId.length > 0) {
      const stateResult = await runDocker(
        [
          'inspect',
          '--format',
          '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.ExitCode}}',
          containerId
        ],
        { allowFailure: true, capture: true, silent: true }
      );
      lastState = stateResult.output.trim() || lastState;
      const [status, health, exitCodeText] = lastState.split(/\s+/);

      if (status === 'running' && health === 'healthy') {
        return;
      }

      if (status === 'exited' || status === 'dead') {
        throw new Error(`${service} container stopped before becoming healthy: ${lastState}`);
      }

      const containerExitCode = Number(exitCodeText);
      if (Number.isFinite(containerExitCode) && containerExitCode !== 0) {
        throw new Error(`${service} container failed before becoming healthy: ${lastState}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${service} to become healthy. Last state: ${lastState}`);
}

function runDocker(args, options = {}) {
  return runCommand('docker', args, options);
}

function runCompose(args, options = {}) {
  return runCommand(composeCommand, [...composePrefix, ...args], options);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: composeEnv,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });

    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk;
      });
    }

    child.on('error', (error) => {
      if (options.allowFailure) {
        resolve({ exitCode: 1, output: `${stdout}${stderr}` });
        return;
      }

      reject(error);
    });
    child.on('exit', (code) => {
      const exit = code ?? 1;
      const output = `${stdout}${stderr}`;

      if (options.capture && output.length > 0 && !options.silent) {
        process.stdout.write(options.redact ? redactSecrets(output) : output);
      }

      if (exit !== 0 && !options.allowFailure) {
        resolve({ exitCode: exit, output });
        return;
      }

      resolve({ exitCode: exit, output });
    });
  });
}

async function collectFailureEvidence() {
  await runCompose(['ps'], { allowFailure: true });
  await runCompose(['logs', '--no-color', '--tail', '200', 'postgres', 'migrate', 'app', 'real-backend-playwright'], {
    allowFailure: true,
    capture: true,
    redact: true
  });
}

function redactSecrets(output) {
  return output
    .replace(/(POSTGRES_PASSWORD:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(AIP_BROWSER_SMOKE_PASSWORD:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(AIP_[A-Z0-9_]*PASSWORD:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(Password=)[^;\s\r\n]+/gi, '$1[redacted]');
}
