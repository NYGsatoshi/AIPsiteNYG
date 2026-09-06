import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  findCaseInsensitiveCollisions,
  loadOsPortabilityContract
} from './os-portability-contract.mjs';
import { readTrxCounters } from './verify-os-portability-results.mjs';

const STEP_ENVIRONMENT = {
  checkout: 'PORTABILITY_STEP_CHECKOUT',
  setupDotnet: 'PORTABILITY_STEP_SETUP_DOTNET',
  setupNode: 'PORTABILITY_STEP_SETUP_NODE',
  npmToolchain: 'PORTABILITY_STEP_NPM_TOOLCHAIN',
  contract: 'PORTABILITY_STEP_CONTRACT',
  rootDependencies: 'PORTABILITY_STEP_ROOT_DEPENDENCIES',
  frontendDependencies: 'PORTABILITY_STEP_FRONTEND_DEPENDENCIES',
  dotnetRestore: 'PORTABILITY_STEP_DOTNET_RESTORE',
  dotnetBuild: 'PORTABILITY_STEP_DOTNET_BUILD',
  dotnetTests: 'PORTABILITY_STEP_DOTNET_TESTS',
  dotnetResults: 'PORTABILITY_STEP_DOTNET_RESULTS',
  frontendBuild: 'PORTABILITY_STEP_FRONTEND_BUILD',
  frontendTests: 'PORTABILITY_STEP_FRONTEND_TESTS',
  frontendHelpers: 'PORTABILITY_STEP_FRONTEND_HELPERS',
  compatCriticalDiscovery: 'PORTABILITY_STEP_COMPAT_CRITICAL'
};

const PORTABLE_TEXT_FILES = [
  '.github/workflows/os-portability.yml',
  'scripts/ci/os-portability.contract.json',
  'scripts/ci/os-portability-contract.mjs',
  'scripts/ci/verify-os-portability-results.mjs',
  'scripts/ci/write-os-portability-evidence.mjs',
  'global.json',
  'package.json',
  'frontend/package.json'
];

export async function buildOsPortabilityEvidence(repositoryRoot = process.cwd()) {
  const root = path.resolve(repositoryRoot);
  const contract = await loadOsPortabilityContract(path.join(root, 'scripts/ci/os-portability.contract.json'));
  const steps = Object.fromEntries(
    Object.entries(STEP_ENVIRONMENT).map(([name, environmentName]) => [name, normalizeOutcome(process.env[environmentName])])
  );
  const trackedPaths = listTrackedPaths(root);
  const caseCollisions = findCaseInsensitiveCollisions(trackedPaths);
  const lineEndings = {};
  for (const relativePath of PORTABLE_TEXT_FILES) {
    lineEndings[relativePath] = detectLineEndings(await readFile(path.join(root, relativePath), 'utf8'));
  }

  const evidence = {
    schemaVersion: 1,
    contract: contract.name,
    issue: contract.issue,
    generatedAtUtc: new Date().toISOString(),
    identity: {
      repository: process.env.GITHUB_REPOSITORY ?? null,
      commitSha: process.env.GITHUB_SHA ?? null,
      ref: process.env.GITHUB_REF ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      matrixOs: process.env.PORTABILITY_MATRIX_OS ?? null,
      runnerOs: process.env.PORTABILITY_RUNNER_OS ?? null,
      runnerArch: process.env.PORTABILITY_RUNNER_ARCH ?? null,
      runnerImageOs: process.env.ImageOS ?? null,
      runnerImageVersion: process.env.ImageVersion ?? null
    },
    result: summarizeOutcomes(steps),
    steps,
    toolchain: {
      declared: {
        dotnetSdk: await declaredDotnetVersion(root, contract.toolchain.dotnetGlobalJson),
        nodeMajor: contract.toolchain.nodeMajor,
        npmVersion: contract.toolchain.npmVersion
      },
      observed: {
        dotnetSdk: commandVersion('dotnet', ['--version']),
        node: process.version,
        npm: commandVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']),
        git: commandVersion('git', ['--version'])
      }
    },
    filesystem: {
      platform: process.platform,
      architecture: process.arch,
      gitCoreAutocrlf: commandVersion('git', ['config', '--get', 'core.autocrlf'], 'unset'),
      trackedPathCount: trackedPaths.length,
      caseInsensitiveCollisions: caseCollisions,
      portableTextLineEndings: lineEndings
    },
    dotnetTests: await readOptionalTrx(path.join(root, 'artifacts/os-portability/os-portability.trx')),
    boundaries: contract.boundaries
  };
  return evidence;
}

export async function writeOsPortabilityEvidence(outputPath, repositoryRoot = process.cwd()) {
  const evidence = await buildOsPortabilityEvidence(repositoryRoot);
  const absoluteOutput = path.resolve(repositoryRoot, outputPath);
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

function normalizeOutcome(value) {
  const allowed = new Set(['success', 'failure', 'cancelled', 'skipped']);
  return allowed.has(value) ? value : 'unknown';
}

function summarizeOutcomes(steps) {
  const outcomes = Object.values(steps);
  if (outcomes.includes('failure')) {
    return 'failure';
  }
  if (outcomes.includes('cancelled')) {
    return 'cancelled';
  }
  if (outcomes.every((outcome) => outcome === 'success')) {
    return 'success';
  }
  return 'incomplete';
}

function commandVersion(command, args, unavailable = null) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    return unavailable;
  }
  return result.stdout.trim() || unavailable;
}

function listTrackedPaths(root) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  return result.status === 0 ? result.stdout.split('\0').filter(Boolean) : [];
}

function detectLineEndings(contents) {
  const crlf = (contents.match(/\r\n/gu) ?? []).length;
  const lf = (contents.match(/(?<!\r)\n/gu) ?? []).length;
  if (crlf > 0 && lf > 0) {
    return 'mixed';
  }
  if (crlf > 0) {
    return 'crlf';
  }
  if (lf > 0) {
    return 'lf';
  }
  return 'none';
}

async function declaredDotnetVersion(root, globalJsonPath) {
  const globalJson = JSON.parse(await readFile(path.join(root, globalJsonPath), 'utf8'));
  return globalJson.sdk.version;
}

async function readOptionalTrx(trxPath) {
  try {
    return { available: true, counters: readTrxCounters(await readFile(trxPath, 'utf8')) };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseArguments(args) {
  let output = 'artifacts/os-portability/evidence.json';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--output') {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
    output = args[++index];
    if (!output) {
      throw new Error('--output requires a path.');
    }
  }
  return { output };
}

try {
  const { output } = parseArguments(process.argv.slice(2));
  const evidence = await writeOsPortabilityEvidence(output);
  console.log(`OS portability evidence written: ${output}; result=${evidence.result}; os=${evidence.identity.matrixOs ?? process.platform}.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### OS portability: ${evidence.identity.matrixOs ?? process.platform}\n\n- result: ${evidence.result}\n- Node: ${evidence.toolchain.observed.node}\n- npm: ${evidence.toolchain.observed.npm ?? 'unavailable'}\n- .NET SDK: ${evidence.toolchain.observed.dotnetSdk ?? 'unavailable'}\n- portable .NET TRX: ${evidence.dotnetTests.available ? `${evidence.dotnetTests.counters.passed}/${evidence.dotnetTests.counters.total} passed` : 'unavailable'}\n- case-insensitive tracked-path collisions: ${evidence.filesystem.caseInsensitiveCollisions.length}\n`,
      'utf8'
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
