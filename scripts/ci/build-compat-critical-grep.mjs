import { pathToFileURL } from 'node:url';

import {
  buildCompatCriticalGrep,
  loadCompatCriticalContract,
  selectedCompatCriticalFiles,
  verifyCompatCriticalSources
} from './compat-critical-contract.mjs';

const DEFAULT_CONTRACT = 'scripts/ci/compat-critical.contract.json';

export async function buildCompatCriticalSelection(options = {}) {
  const contractPath = options.contractPath ?? DEFAULT_CONTRACT;
  const contract = await loadCompatCriticalContract(contractPath);
  const profile = options.profile ?? contract.defaultProfile;
  if (options.verifySources !== false) {
    await verifyCompatCriticalSources(contract, options.repositoryRoot ?? process.cwd());
  }
  return {
    profile,
    grep: buildCompatCriticalGrep(contract, profile),
    files: selectedCompatCriticalFiles(contract, profile)
  };
}

if (isMainModule()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const selection = await buildCompatCriticalSelection(options);
    if (options.format === 'files') {
      process.stdout.write(`${selection.files.join('\n')}\n`);
    } else if (options.format === 'json') {
      process.stdout.write(`${JSON.stringify(selection)}\n`);
    } else {
      process.stdout.write(selection.grep);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

function parseArguments(args) {
  const options = { contractPath: DEFAULT_CONTRACT, profile: undefined, verifySources: true, format: 'grep' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '--contract':
        options.contractPath = requireValue(args, ++index, '--contract');
        break;
      case '--profile':
        options.profile = requireValue(args, ++index, '--profile');
        break;
      case '--no-verify-sources':
        options.verifySources = false;
        break;
      case '--files':
        options.format = 'files';
        break;
      case '--json':
        options.format = 'json';
        break;
      default:
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
  return Boolean(entryPoint) && import.meta.url === pathToFileURL(entryPoint).href;
}
