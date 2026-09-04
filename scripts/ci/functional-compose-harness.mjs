import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const COMPOSE_PROJECT_NAME_MAX_LENGTH = 63;
const DEFAULT_SETUP_TIMEOUT_MS = 240_000;

export const composeV2Invocation = Object.freeze({
  command: 'docker',
  prefix: ['compose']
});

export const legacyComposeInvocation = Object.freeze({
  command: 'docker-compose',
  prefix: []
});

export const FunctionalFailureClassification = Object.freeze({
  setup: 'INFRA/SETUP FAILURE',
  product: 'PRODUCT TEST FAILURE'
});

export const canonicalFunctionalFixtureAliases = Object.freeze({
  actorEmail: 'e2e-user@example.test',
  restrictedActorEmail: 'browser-smoke-recipient@example.test',
  workspaceSlug: 'browser-smoke-workspace',
  workspaceName: 'Browser Smoke Workspace',
  projectSlug: 'browser-smoke-project',
  projectName: 'Browser Smoke Project',
  taskTitle: 'Browser smoke task',
  eligibleFileName: 'browser-smoke-task.txt',
  announcementTitle: 'Browser smoke announcement'
});

export class FunctionalHarnessError extends Error {
  constructor(phase, message, options = {}) {
    super(message, options);
    this.name = 'FunctionalHarnessError';
    this.phase = phase;
    this.classification = FunctionalFailureClassification.setup;
  }
}

export function composeProjectName(parts, maxLength = COMPOSE_PROJECT_NAME_MAX_LENGTH) {
  const normalized = parts
    .filter((part) => part !== undefined && part !== null && String(part).trim().length > 0)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-_]+$/, '');

  const fallback = 'aipsite-real-backend-smoke';
  const withinLimit = (normalized || fallback).slice(0, maxLength).replace(/[-_]+$/, '');
  return withinLimit || 'aipsite';
}

export function getComposeProjectName(environment, processId) {
  const override = environment.FUNCTIONAL_COMPOSE_PROJECT_NAME ?? environment.REAL_BACKEND_SMOKE_COMPOSE_PROJECT_NAME;
  if (typeof override === 'string' && override.trim().length > 0) {
    return composeProjectName([override]);
  }

  return composeProjectName([
    'aipsite-functional',
    environment.GITHUB_RUN_ID,
    environment.GITHUB_RUN_ATTEMPT,
    environment.CI ? 'ci' : 'local',
    processId
  ]);
}

export function buildCanonicalFunctionalFixtureEnvironment(environment = {}) {
  const actorEmail = environment.AIP_BROWSER_SMOKE_EMAIL ?? canonicalFunctionalFixtureAliases.actorEmail;
  const actorPassword = environment.AIP_BROWSER_SMOKE_PASSWORD ?? 'E2eSmoke!23456';

  if (!actorEmail.toLowerCase().endsWith('@example.test')) {
    throw new FunctionalHarnessError(
      'fixture-profile',
      'Canonical Functional CI actor must use the reserved synthetic @example.test domain.'
    );
  }
  if (!actorPassword) {
    throw new FunctionalHarnessError('fixture-profile', 'Canonical Functional CI actor password must be defined.');
  }

  return Object.freeze({
    AIP_BROWSER_SMOKE_SEED_ENABLED: 'true',
    AIP_BROWSER_SMOKE_RESPONSE_GATE_ENABLED: 'true',
    AIP_BROWSER_SMOKE_EMAIL: actorEmail,
    AIP_BROWSER_SMOKE_PASSWORD: actorPassword
  });
}

export async function selectComposeInvocation(runVersion) {
  if (await runVersion('docker', ['compose', 'version'])) {
    return composeV2Invocation;
  }

  if (await runVersion('docker-compose', ['version'])) {
    return legacyComposeInvocation;
  }

  throw new FunctionalHarnessError(
    'validate-host',
    'Docker Compose is required for Functional CI. Install Docker Compose v2 so `docker compose version` succeeds; legacy `docker-compose version` is also supported.'
  );
}

export function isStaticAngularServerUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.port === '4173' && (host === '127.0.0.1' || host === 'localhost' || host === '::1');
  } catch {
    return false;
  }
}

export function isHstsPreloadedHttpUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'http:' && (host === 'app' || host.endsWith('.app'));
  } catch {
    return false;
  }
}

export function normalizeExitCode(code) {
  return Number.isInteger(code) && code >= 0 ? code : 1;
}

export function redactSecrets(output, secretValues = []) {
  let redacted = String(output)
    .replace(/(POSTGRES_PASSWORD\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(SYNCFUSION_LICENSE\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(AIP_[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|LICENSE)\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:Password|Pwd)=)[^;\s\r\n]+/gi, '$1[redacted]')
    .replace(/(Authorization\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:X-CSRF-Token|CSRF(?:Token)?)\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:Invite|Invitation)[A-Za-z-]*Token\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/("(?:password|token|secret|license|authorization|cookie|csrfToken|inviteToken|invitationToken)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2');

  for (const value of secretValues) {
    if (typeof value !== 'string' || value.length < 4) {
      continue;
    }
    redacted = redacted.split(value).join('[redacted]');
  }

  return redacted;
}

export function formatFailureClassification(classification, phase, message) {
  return `[${classification}] phase=${phase}: ${message}`;
}

export class FunctionalComposeHarness {
  constructor({
    composeFiles,
    projectName,
    environment = process.env,
    diagnosticDirectory = 'test-results',
    diagnosticPrefix = 'functional',
    setupTimeoutMs = DEFAULT_SETUP_TIMEOUT_MS,
    services = {},
    spawnImpl = spawn
  }) {
    if (!Array.isArray(composeFiles) || composeFiles.length === 0) {
      throw new TypeError('FunctionalComposeHarness requires at least one Compose file.');
    }
    if (!projectName) {
      throw new TypeError('FunctionalComposeHarness requires an isolated Compose project name.');
    }

    this.composeFiles = [...composeFiles];
    this.projectName = projectName;
    this.environment = { ...environment, COMPOSE_PROJECT_NAME: projectName };
    this.diagnosticDirectory = diagnosticDirectory;
    this.diagnosticPrefix = diagnosticPrefix;
    this.setupTimeoutMs = setupTimeoutMs;
    this.services = {
      database: services.database ?? 'postgres',
      migration: services.migration ?? 'migrate',
      app: services.app ?? 'app',
      test: services.test ?? 'real-backend-playwright'
    };
    this.spawnImpl = spawnImpl;
    this.composeInvocation = null;
    this.cleanupPromise = null;
  }

  async initialize() {
    this.composeInvocation = await selectComposeInvocation(async (command, args) => {
      const result = await this.runCommand(command, args, { capture: true, silent: true });
      return result.exitCode === 0;
    });
    return this.composeInvocation;
  }

  composeBaseArgs() {
    return ['-p', this.projectName, ...this.composeFiles.flatMap((file) => ['-f', file])];
  }

  async validateHost() {
    this.requireComposeInvocation();
    await this.runSetupCompose('validate-compose-config', ['config', '--quiet'], { capture: true, redact: true });
    const dockerInfo = await this.runCommand('docker', ['info', '--format', '{{.ServerVersion}}'], {
      capture: true,
      silent: true
    });
    if (dockerInfo.exitCode !== 0) {
      throw new FunctionalHarnessError('validate-host', 'Docker daemon is not available to Functional CI.');
    }
  }

  async buildRequiredImages() {
    await this.runSetupCompose('build-images', ['build', this.services.app, this.services.test]);
  }

  async startPostgres() {
    await this.runSetupCompose('start-postgres', ['up', '--detach', this.services.database]);
    await this.waitForHealthy(this.services.database, 'postgres-readiness');
  }

  async applyMigrations() {
    await this.runSetupCompose('apply-migrations', ['up', '--detach', this.services.migration]);
    await this.waitForCompleted(this.services.migration, 'migration-head');
  }

  async startApplication() {
    await this.runSetupCompose('start-application', ['up', '--detach', '--no-deps', this.services.app]);
    await this.waitForHealthy(this.services.app, 'application-readiness');
  }

  async provisionBaseStack() {
    await this.validateHost();
    await this.buildRequiredImages();
    await this.startPostgres();
    await this.applyMigrations();
    await this.startApplication();
  }

  async runSuite(composeArgs) {
    this.requireComposeInvocation();
    const result = await this.runCompose(composeArgs);
    if (result.exitCode !== 0) {
      console.error(formatFailureClassification(
        FunctionalFailureClassification.product,
        'execute-suite',
        `suite process exited with code ${result.exitCode}`
      ));
    }
    return result;
  }

  async waitForHealthy(service, phase = `${service}-readiness`) {
    const deadline = Date.now() + this.setupTimeoutMs;
    let lastState = 'not created';

    while (Date.now() < deadline) {
      const containerId = await this.getServiceContainerId(service);
      if (containerId) {
        const state = await this.inspectContainerState(containerId);
        lastState = state || lastState;
        const [status, health, exitCodeText] = lastState.split(/\s+/);
        if (status === 'running' && health === 'healthy') {
          return;
        }
        if (status === 'exited' || status === 'dead') {
          throw new FunctionalHarnessError(phase, `${service} stopped before becoming healthy: ${lastState}`);
        }
        const containerExitCode = Number(exitCodeText);
        if (Number.isFinite(containerExitCode) && containerExitCode !== 0) {
          throw new FunctionalHarnessError(phase, `${service} failed before becoming healthy: ${lastState}`);
        }
      }
      await delay(1_000);
    }

    throw new FunctionalHarnessError(phase, `Timed out waiting for ${service} to become healthy. Last state: ${lastState}`);
  }

  async waitForCompleted(service, phase = `${service}-completion`) {
    const deadline = Date.now() + this.setupTimeoutMs;
    let lastState = 'not created';

    while (Date.now() < deadline) {
      const containerId = await this.getServiceContainerId(service);
      if (containerId) {
        const state = await this.inspectContainerState(containerId);
        lastState = state || lastState;
        const [status, , exitCodeText] = lastState.split(/\s+/);
        const exitCode = Number(exitCodeText);
        if (status === 'exited' && exitCode === 0) {
          return;
        }
        if ((status === 'exited' || status === 'dead') && Number.isFinite(exitCode)) {
          throw new FunctionalHarnessError(phase, `${service} failed: ${lastState}`);
        }
      }
      await delay(1_000);
    }

    throw new FunctionalHarnessError(phase, `Timed out waiting for ${service} to complete. Last state: ${lastState}`);
  }

  async getServiceContainerId(service) {
    const result = await this.runCompose(['ps', '--all', '-q', service], {
      allowFailure: true,
      capture: true,
      silent: true
    });
    return result.output.trim().split(/\s+/)[0] || '';
  }

  async inspectContainerState(containerId) {
    const result = await this.runCommand(
      'docker',
      [
        'inspect',
        '--format',
        '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.ExitCode}}',
        containerId
      ],
      { allowFailure: true, capture: true, silent: true }
    );
    return result.output.trim();
  }

  async runSetupCompose(phase, args, options = {}) {
    const result = await this.runCompose(args, options);
    if (result.exitCode !== 0) {
      throw new FunctionalHarnessError(phase, `Compose command failed with exit code ${result.exitCode}.`);
    }
    return result;
  }

  async runCompose(args, options = {}) {
    this.requireComposeInvocation();
    return this.runCommand(
      this.composeInvocation.command,
      [...this.composeInvocation.prefix, ...this.composeBaseArgs(), ...args],
      options
    );
  }

  runCommand(command, args, options = {}) {
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let spawnError;
      const child = this.spawnImpl(command, args, {
        cwd: process.cwd(),
        env: this.environment,
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
      });

      const finish = (code) => {
        if (settled) return;
        settled = true;
        const output = `${stdout}${stderr}${spawnError ? `${spawnError.message}\n` : ''}`;
        if (options.capture && output.length > 0 && !options.silent) {
          process.stdout.write(options.redact ? this.redact(output) : output);
        }
        resolve({ exitCode: normalizeExitCode(code), output });
      };

      if (options.capture) {
        child.stdout?.on('data', (chunk) => { stdout += chunk; });
        child.stderr?.on('data', (chunk) => { stderr += chunk; });
      }
      child.once('error', (error) => {
        spawnError = error;
        finish(127);
      });
      child.once('close', (code) => finish(code));
    });
  }

  redact(output) {
    const secretValues = [
      this.environment.SYNCFUSION_LICENSE,
      this.environment.AIP_BROWSER_SMOKE_PASSWORD,
      this.environment.POSTGRES_PASSWORD
    ];
    return redactSecrets(output, secretValues);
  }

  async collectFailureDiagnostics(extraServices = []) {
    if (!this.composeInvocation) return;

    await mkdir(this.diagnosticDirectory, { recursive: true });
    const services = [...new Set([
      this.services.database,
      this.services.migration,
      this.services.app,
      this.services.test,
      ...extraServices
    ].filter(Boolean))];

    const ps = await this.runCompose(['ps', '--all'], { allowFailure: true, capture: true, silent: true });
    await this.writeSanitizedDiagnostic('compose-ps.txt', ps.output);

    const migrationId = await this.getServiceContainerId(this.services.migration);
    const migrationState = migrationId
      ? await this.inspectContainerState(migrationId)
      : 'not created';
    await this.writeSanitizedDiagnostic('migration-status.txt', `${migrationState}\n`);

    for (const service of services) {
      const logs = await this.runCompose(['logs', '--no-color', '--tail', '300', service], {
        allowFailure: true,
        capture: true,
        silent: true
      });
      await this.writeSanitizedDiagnostic(`${service}.log`, logs.output);
    }
  }

  async writeSanitizedDiagnostic(suffix, output) {
    const destination = path.join(this.diagnosticDirectory, `${this.diagnosticPrefix}-${suffix}`);
    await writeFile(destination, this.redact(output), 'utf8');
  }

  cleanup() {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = this.composeInvocation
      ? this.runCompose(['down', '--volumes', '--remove-orphans'], {
          allowFailure: true,
          capture: true,
          silent: true
        })
      : Promise.resolve({ exitCode: 0, output: '' });
    return this.cleanupPromise;
  }

  requireComposeInvocation() {
    if (!this.composeInvocation) {
      throw new FunctionalHarnessError('validate-host', 'Docker Compose command was not selected.');
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
