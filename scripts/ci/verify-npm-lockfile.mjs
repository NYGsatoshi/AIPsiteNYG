#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectDirectory = path.resolve(process.argv[2] ?? '.');
const packageJsonPath = path.join(projectDirectory, 'package.json');
const lockfilePath = path.join(projectDirectory, 'package-lock.json');

const knownCompromisedVersions = new Map([
  ['keyv', new Set(['6.0.0'])],
  ['flat-cache', new Set(['6.1.24'])],
  ['file-entry-cache', new Set(['11.1.6'])],
  ['cacheable-request', new Set(['13.0.20'])],
  ['cacheable', new Set(['2.5.1'])],
  ['@cacheable/memory', new Set(['2.2.1'])],
  ['cache-manager', new Set(['7.2.10'])],
  ['@cacheable/node-cache', new Set(['3.1.2'])],
  ['@cacheable/utils', new Set(['2.5.1'])],
  ['@cacheable/net', new Set(['2.1.1'])],
  ['ecto', new Set(['5.0.1'])],
  ['@deliveroo/reevent', new Set(['1.0.1'])],
  ['@or-sdk/invitations', new Set(['1.4.9'])],
  ['@picsart/ai-sdk', new Set(['3.32.2'])],
  ['@qlik/embed-runtime', new Set(['1.6.4'])],
  ['picasso.js', new Set(['2.11.6'])],
]);

const knownCampaignMarkers = [
  /npm-cache\.com/i,
  /pypi-get\.com/i,
  /js-mirror\.com/i,
  /Shai-Hulud:\s*Here We Go Again/i,
];

function fail(message) {
  console.error(`npm lockfile policy violation: ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`required file is missing: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const markerIndex = lockPath.lastIndexOf(marker);
  return markerIndex >= 0 ? lockPath.slice(markerIndex + marker.length) : null;
}

function currentPlatformCanInstall(metadata) {
  const evaluateList = (values, currentValue) => {
    if (!Array.isArray(values) || values.length === 0) {
      return true;
    }

    const denied = values
      .filter((value) => typeof value === 'string' && value.startsWith('!'))
      .map((value) => value.slice(1));
    if (denied.includes(currentValue)) {
      return false;
    }

    const allowed = values.filter(
      (value) => typeof value === 'string' && !value.startsWith('!'),
    );
    return allowed.length === 0 || allowed.includes(currentValue);
  };

  return (
    evaluateList(metadata.os, process.platform) &&
    evaluateList(metadata.cpu, process.arch)
  );
}

function resolveInstallScriptDecision(allowScripts, packageName, version) {
  const exactKey = `${packageName}@${version}`;
  if (Object.hasOwn(allowScripts, exactKey)) {
    return { key: exactKey, value: allowScripts[exactKey] };
  }

  if (Object.hasOwn(allowScripts, packageName)) {
    return { key: packageName, value: allowScripts[packageName] };
  }

  return null;
}

let packageJson;
let lockfile;
let rawLockfile;

try {
  packageJson = readJson(packageJsonPath);
  rawLockfile = fs.readFileSync(lockfilePath, 'utf8');
  lockfile = JSON.parse(rawLockfile);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!Number.isInteger(lockfile.lockfileVersion) || lockfile.lockfileVersion < 3) {
  fail(`${lockfilePath} must use lockfileVersion 3 or newer`);
}

for (const marker of knownCampaignMarkers) {
  if (marker.test(rawLockfile)) {
    fail(`${lockfilePath} contains known campaign marker ${marker}`);
  }
}

const allowScripts = packageJson.allowScripts ?? {};
if (
  typeof allowScripts !== 'object' ||
  Array.isArray(allowScripts) ||
  allowScripts === null
) {
  fail(`${packageJsonPath} allowScripts must be an object`);
}

for (const [key, value] of Object.entries(allowScripts)) {
  if (value !== true && value !== false) {
    fail(`allowScripts entry ${key} must be true or false`);
  }

  if (value === true && !key.includes('@', key.startsWith('@') ? 1 : 0)) {
    fail(`allowed install script ${key} must be pinned to an exact version`);
  }
}

let packageCount = 0;
let approvedInstallScriptCount = 0;
let deniedInstallScriptCount = 0;
let skippedPlatformInstallScriptCount = 0;
const observedAllowScriptKeys = new Set();

for (const [lockPath, metadata] of Object.entries(lockfile.packages ?? {})) {
  if (lockPath === '' || metadata?.link === true) {
    continue;
  }

  const packageName = packageNameFromLockPath(lockPath);
  const version = metadata?.version;
  if (!packageName || typeof version !== 'string') {
    continue;
  }

  packageCount += 1;

  const compromisedVersions = knownCompromisedVersions.get(packageName);
  if (compromisedVersions?.has(version)) {
    fail(`known compromised package detected: ${packageName}@${version}`);
  }

  if (typeof metadata.resolved === 'string') {
    let resolvedUrl;
    try {
      resolvedUrl = new URL(metadata.resolved);
    } catch {
      fail(`${packageName}@${version} has an invalid resolved URL`);
      continue;
    }

    if (
      resolvedUrl.protocol !== 'https:' ||
      resolvedUrl.hostname !== 'registry.npmjs.org'
    ) {
      fail(
        `${packageName}@${version} resolves outside registry.npmjs.org: ${metadata.resolved}`,
      );
    }

    if (typeof metadata.integrity !== 'string' || metadata.integrity.length === 0) {
      fail(`${packageName}@${version} is missing an integrity hash`);
    }
  }

  if (metadata.hasInstallScript !== true) {
    continue;
  }

  if (!currentPlatformCanInstall(metadata)) {
    skippedPlatformInstallScriptCount += 1;
    continue;
  }

  const decision = resolveInstallScriptDecision(
    allowScripts,
    packageName,
    version,
  );

  if (!decision) {
    fail(`unreviewed install script detected: ${packageName}@${version}`);
    continue;
  }

  observedAllowScriptKeys.add(decision.key);

  if (decision.value === true) {
    approvedInstallScriptCount += 1;
  } else {
    deniedInstallScriptCount += 1;
  }
}

for (const [key, value] of Object.entries(allowScripts)) {
  if (value === true && !observedAllowScriptKeys.has(key)) {
    console.warn(`npm lockfile policy warning: stale allowScripts entry ${key}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(
  [
    `npm lockfile policy passed for ${projectDirectory}`,
    `packages=${packageCount}`,
    `approvedInstallScripts=${approvedInstallScriptCount}`,
    `deniedInstallScripts=${deniedInstallScriptCount}`,
    `platformSkippedInstallScripts=${skippedPlatformInstallScriptCount}`,
  ].join(' '),
);
