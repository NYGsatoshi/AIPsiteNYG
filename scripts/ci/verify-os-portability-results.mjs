import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadOsPortabilityContract } from './os-portability-contract.mjs';

const REQUIRED_COUNTERS = [
  'total',
  'executed',
  'passed',
  'failed',
  'error',
  'timeout',
  'aborted',
  'inconclusive',
  'notRunnable',
  'notExecuted',
  'disconnected',
  'warning',
  'completed',
  'inProgress',
  'pending',
  'passedButRunAborted'
];
const FAILURE_COUNTERS = REQUIRED_COUNTERS.filter((name) => !['total', 'executed', 'passed'].includes(name));

export function readTrxCounters(trxXml) {
  const match = /<Counters\b(?<attributes>[\s\S]*?)\/?\s*>/u.exec(String(trxXml));
  if (!match) {
    throw new Error('TRX Counters element is missing.');
  }
  const attributes = match.groups?.attributes ?? '';

  const counters = {};
  for (const name of REQUIRED_COUNTERS) {
    const attribute = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'u').exec(attributes);
    if (!attribute) {
      throw new Error(`TRX Counters attribute is missing: ${name}.`);
    }
    if (!/^\d+$/u.test(attribute[1])) {
      throw new Error(`TRX Counters attribute is not a non-negative integer: ${name}=${attribute[1]}.`);
    }
    counters[name] = Number(attribute[1]);
  }
  return counters;
}

export function verifyTrxCounters(counters, minimumTotal) {
  if (!Number.isInteger(minimumTotal) || minimumTotal < 1) {
    throw new Error('minimumTotal must be a positive integer.');
  }
  const failures = [];
  if (counters.total < minimumTotal) {
    failures.push(`total ${counters.total} is below required minimum ${minimumTotal}`);
  }
  if (counters.executed !== counters.total) {
    failures.push(`executed ${counters.executed} does not equal total ${counters.total}`);
  }
  if (counters.passed !== counters.total) {
    failures.push(`passed ${counters.passed} does not equal total ${counters.total}`);
  }
  for (const name of FAILURE_COUNTERS) {
    if (counters[name] !== 0) {
      failures.push(`${name} is non-zero: ${counters[name]}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Portable .NET TRX verification failed:\n- ${failures.join('\n- ')}`);
  }
  return counters;
}

export async function verifyTrxFile(trxPath, minimumTotal) {
  let contents;
  try {
    contents = await readFile(trxPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read portable .NET TRX ${trxPath}: ${error instanceof Error ? error.message : error}`);
  }
  return verifyTrxCounters(readTrxCounters(contents), minimumTotal);
}

function parseArguments(args) {
  const options = {
    contractPath: 'scripts/ci/os-portability.contract.json',
    trxPath: 'artifacts/os-portability/os-portability.trx'
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--contract') {
      options.contractPath = requireValue(args, ++index, argument);
    } else if (argument === '--trx') {
      options.trxPath = requireValue(args, ++index, argument);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function requireValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function isMainModule() {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint) && import.meta.url === pathToFileURL(path.resolve(entryPoint)).href;
}

if (isMainModule()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const contract = await loadOsPortabilityContract(options.contractPath);
    const counters = await verifyTrxFile(options.trxPath, contract.dotnet.minimumTests);
    console.log(
      `Portable .NET TRX passed: total=${counters.total}; executed=${counters.executed}; passed=${counters.passed}; failed=${counters.failed}.`
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `### Portable .NET subset\n\n- total: ${counters.total}\n- executed: ${counters.executed}\n- passed: ${counters.passed}\n- failed: ${counters.failed}\n`,
        'utf8'
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
