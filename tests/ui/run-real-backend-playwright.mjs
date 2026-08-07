import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  isHstsPreloadedHttpUrl,
  isStaticAngularServerUrl
} from './real-backend-smoke-compose-helpers.mjs';

const playwrightCli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
const userArgs = process.argv.slice(2);
const focusedGrep = process.env.AIP_REAL_BACKEND_SMOKE_GREP?.trim();
const playwrightArgs = [
  ...(userArgs.length > 0
    ? userArgs
    : ['tests/ui/real-backend-smoke.spec.ts', '--project=chromium-desktop', '--retries=0', '--workers=1']),
  ...(focusedGrep ? ['--grep', focusedGrep] : [])
];

let exitCode = 1;

try {
  const configuration = validateConfiguration(process.env);
  await waitForReady(configuration.baseURL);
  exitCode = await runPlaywright(configuration.baseURL);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
}

process.exitCode = exitCode;

function validateConfiguration(environment) {
  const baseURL = environment.PLAYWRIGHT_BASE_URL?.trim();
  const email = environment.AIP_BROWSER_SMOKE_EMAIL?.trim();
  const password = environment.AIP_BROWSER_SMOKE_PASSWORD;

  if (environment.AIP_REAL_BACKEND_SMOKE !== '1') {
    throw new Error('AIP_REAL_BACKEND_SMOKE=1 is required. Use `npm run test:ui:real-backend` for the self-contained real-backend smoke.');
  }

  if (!baseURL) {
    throw new Error('PLAYWRIGHT_BASE_URL is required for the real-backend smoke. The Compose runner sets it to http://aip-backend:8080.');
  }

  try {
    new URL(baseURL);
  } catch {
    throw new Error('PLAYWRIGHT_BASE_URL must be an absolute HTTP(S) URL for the real-backend smoke.');
  }

  if (isStaticAngularServerUrl(baseURL)) {
    throw new Error('PLAYWRIGHT_BASE_URL points to the static Angular server on port 4173. Use `npm run test:ui:real-backend` instead of the static runner.');
  }

  if (isHstsPreloadedHttpUrl(baseURL)) {
    throw new Error('PLAYWRIGHT_BASE_URL uses an HTTP .app hostname that Chromium upgrades to HTTPS through HSTS. Use the Compose alias http://aip-backend:8080.');
  }

  if (!email) {
    throw new Error('AIP_BROWSER_SMOKE_EMAIL is required for the real-backend smoke seed.');
  }

  if (!email.toLowerCase().endsWith('@example.test')) {
    throw new Error('AIP_BROWSER_SMOKE_EMAIL must use synthetic @example.test data for the real-backend smoke.');
  }

  if (!password) {
    throw new Error('AIP_BROWSER_SMOKE_PASSWORD is required for the real-backend smoke seed.');
  }

  return { baseURL };
}

function runPlaywright(baseURL) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (!settled) {
        settled = true;
        resolve(Number.isInteger(code) && code >= 0 ? code : 1);
      }
    };

    const child = spawn(process.execPath, [playwrightCli, 'test', ...playwrightArgs], {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseURL },
      stdio: 'inherit'
    });

    child.once('error', (error) => {
      console.error(`Unable to start Playwright: ${error.message}`);
      finish(1);
    });
    child.once('close', finish);
  });
}

async function waitForReady(baseURL) {
  const readinessUrl = new URL('/health/ready', baseURL).toString();
  const deadline = Date.now() + 180_000;
  let lastStatus = '';
  let connectionRefused = false;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(readinessUrl);
      lastStatus = `${response.status} ${response.statusText}`;
      if (response.ok) {
        return;
      }
    } catch (error) {
      const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
      connectionRefused ||= code === 'ECONNREFUSED';
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (connectionRefused) {
    throw new Error(`Connection refused while waiting for ${readinessUrl}. The canonical command starts the backend automatically: npm run test:ui:real-backend.`);
  }

  if (lastStatus.startsWith('503')) {
    throw new Error(`Real backend readiness at ${readinessUrl} remained 503. Inspect the app and migrate container logs for database, migration, or seed failures.`);
  }

  throw new Error(`Timed out waiting for real backend readiness at ${readinessUrl}.${lastStatus ? ` Last status: ${lastStatus}` : ''}${lastError ? ` Last error: ${lastError}` : ''}`);
}
