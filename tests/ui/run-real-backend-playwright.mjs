import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8080';
const playwrightCli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
const userArgs = process.argv.slice(2);
const playwrightArgs = userArgs.length > 0
  ? userArgs
  : ['tests/ui/real-backend-smoke.spec.ts', '--project=chromium-desktop', '--retries=0', '--workers=1'];

await waitForHealth(`${baseURL}/health/ready`);
const exitCode = await runPlaywright();
process.exit(exitCode);

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCli, 'test', ...playwrightArgs], {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseURL },
      stdio: 'inherit'
    });

    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 180_000;
  let lastStatus = '';
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      lastStatus = `${response.status} ${response.statusText}`;
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const suffix = lastError ? ` Last error: ${lastError}` : ` Last status: ${lastStatus}`;
  throw new Error(`Timed out waiting for real backend health at ${url}.${suffix}`);
}
