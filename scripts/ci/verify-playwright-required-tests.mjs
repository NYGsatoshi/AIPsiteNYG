import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { readRequiredTestTitles } from './build-playwright-grep.mjs';

export async function verifyPlaywrightRequiredTests(manifestPath, junitPath) {
  const requiredTitles = await readRequiredTestTitles(manifestPath);
  const junitXml = await readFile(junitPath, 'utf8');
  const testCases = parseTestCases(junitXml);
  const errors = [];

  for (const title of requiredTitles) {
    const matches = testCases.filter((testCase) => matchesRequiredTitle(testCase.name, title));
    if (matches.length === 0) {
      errors.push(`Required test is missing from JUnit results: ${title}`);
      continue;
    }

    const passed = matches.some((testCase) => testCase.outcome === 'passed');
    if (!passed) {
      const outcomes = [...new Set(matches.map((testCase) => testCase.outcome))].join(', ');
      errors.push(`Required test did not pass: ${title} (${outcomes || 'unknown'})`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Playwright required-test verification failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  }

  return {
    requiredCount: requiredTitles.length,
    discoveredCaseCount: testCases.length
  };
}

function parseTestCases(junitXml) {
  const testCases = [];
  const pairedPattern = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/gu;
  const selfClosingPattern = /<testcase\b([^>]*)\/>/gu;

  for (const match of junitXml.matchAll(pairedPattern)) {
    testCases.push(toTestCase(match[1], match[2]));
  }

  for (const match of junitXml.matchAll(selfClosingPattern)) {
    testCases.push(toTestCase(match[1], ''));
  }

  return testCases;
}

function toTestCase(attributes, body) {
  const nameMatch = attributes.match(/\bname\s*=\s*"([^"]*)"/u);
  const name = decodeXml(nameMatch?.[1] ?? '');
  let outcome = 'passed';

  if (/<failure\b/u.test(body) || /<error\b/u.test(body)) {
    outcome = 'failed';
  } else if (/<skipped\b/u.test(body)) {
    outcome = 'skipped';
  }

  return { name, outcome };
}

function matchesRequiredTitle(junitName, requiredTitle) {
  return junitName === requiredTitle || junitName.endsWith(` › ${requiredTitle}`) || junitName.includes(requiredTitle);
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

if (isMainModule()) {
  const [manifestPath, junitPath] = process.argv.slice(2);
  if (!manifestPath || !junitPath) {
    console.error('Usage: node scripts/ci/verify-playwright-required-tests.mjs <manifest> <junit-xml>');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyPlaywrightRequiredTests(manifestPath, junitPath);
      console.log(
        `Playwright required-test verification passed: ${result.requiredCount} required tests; ${result.discoveredCaseCount} JUnit cases discovered.`
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}

function isMainModule() {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint) && import.meta.url === pathToFileURL(entryPoint).href;
}
