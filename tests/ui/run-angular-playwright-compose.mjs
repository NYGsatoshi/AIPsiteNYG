import { spawnSync } from 'node:child_process';

function sanitizeProjectName(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+/g, '-')
    .slice(0, 63);

  return normalized || `aipsite-playwright-${process.pid}`;
}

function runDocker(args) {
  return spawnSync('docker', args, {
    stdio: 'inherit',
    env: process.env,
  });
}

const requestedProjectName =
  process.env.COMPOSE_PROJECT_NAME ||
  [
    'aipsite-playwright',
    process.env.GITHUB_RUN_ID || 'local',
    process.env.GITHUB_RUN_ATTEMPT || '1',
    process.env.GITHUB_JOB || process.pid,
  ].join('-');

const projectName = sanitizeProjectName(requestedProjectName);
const composeArgs = ['compose', '-p', projectName, '-f', 'docker-compose.playwright.yml'];

console.log(`Using Docker Compose project: ${projectName}`);

const testResult = runDocker([
  ...composeArgs,
  'run',
  '--build',
  '--rm',
  'angular-playwright',
]);

const cleanupResult = runDocker([
  ...composeArgs,
  'down',
  '--volumes',
  '--remove-orphans',
]);

if (testResult.error) {
  console.error(testResult.error);
  process.exit(1);
}

if (testResult.signal) {
  console.error(`Docker Compose terminated by signal ${testResult.signal}.`);
  process.exit(1);
}

if ((testResult.status ?? 1) !== 0) {
  process.exit(testResult.status ?? 1);
}

if (cleanupResult.error || cleanupResult.signal || (cleanupResult.status ?? 1) !== 0) {
  console.error('Playwright completed, but Docker Compose cleanup failed.');
  process.exit(cleanupResult.status ?? 1);
}
