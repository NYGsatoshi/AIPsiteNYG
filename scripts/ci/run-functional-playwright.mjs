import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { buildFunctionalGrep, parseFunctionalGrepArguments } from './build-functional-grep.mjs';

export function parseFunctionalRunnerArguments(args) {
  const selectionArgs = [];
  const playwrightArgs = [];
  let printGrep = false;
  let passthrough = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (passthrough) {
      playwrightArgs.push(argument);
      continue;
    }

    if (argument === '--') {
      passthrough = true;
      continue;
    }

    if (argument === '--print-grep') {
      printGrep = true;
      continue;
    }

    if (['--negative-authz', '--release-evidence'].includes(argument)) {
      selectionArgs.push(argument);
      continue;
    }

    if (['--gate', '--domain', '--priority', '--backend', '--polarity', '--journey'].includes(argument)) {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      selectionArgs.push(argument, value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown Functional runner argument: ${argument}. Use -- before Playwright arguments.`);
  }

  const filters = parseFunctionalGrepArguments(selectionArgs);
  if (!filters.backends) {
    filters.backends = ['real'];
  }

  return { filters, playwrightArgs, printGrep };
}

export function runFunctionalPlaywright(args = process.argv.slice(2)) {
  const { filters, playwrightArgs, printGrep } = parseFunctionalRunnerArguments(args);
  const grep = buildFunctionalGrep(filters);

  if (printGrep) {
    process.stdout.write(`${grep}\n`);
    return 0;
  }

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    npx,
    ['playwright', 'test', '--config', 'playwright.functional.config.ts', '--grep', grep, ...playwrightArgs],
    {
      env: process.env,
      stdio: 'inherit'
    }
  );

  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (isMainModule()) {
  try {
    process.exitCode = runFunctionalPlaywright();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

function isMainModule() {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint) && import.meta.url === pathToFileURL(entryPoint).href;
}
