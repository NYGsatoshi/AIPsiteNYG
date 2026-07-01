import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const serverPath = fileURLToPath(new URL('./serve-static.mjs', import.meta.url));
const playwrightCli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));

const server = spawn(process.execPath, [serverPath, '--port', String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, PLAYWRIGHT_PORT: String(port) },
  stdio: ['ignore', 'inherit', 'inherit']
});

let exitCode = 1;

try {
  await waitForHealth(`${baseURL}/health`);

  exitCode = await runPlaywright();
} finally {
  await stopServer();
}

process.exit(exitCode);

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCli, 'test'], {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseURL },
      stdio: 'inherit'
    });

    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 120_000;
  let lastError;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Angular Playwright static server exited with code ${server.exitCode}.`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}.${lastError ? ` Last error: ${lastError}` : ''}`);
}

function stopServer() {
  return new Promise((resolve) => {
    if (server.exitCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      server.kill('SIGKILL');
      resolve();
    }, 2_000);

    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    server.kill('SIGTERM');
  });
}
