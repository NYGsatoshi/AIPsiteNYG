import { spawnSync, execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  ISSUE_683_ITERATION_COUNT,
  ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS,
  ISSUE_683_REQUIRED_EXIT_CODE,
  ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT,
  summarizeIssue683Iterations
} from './issue-683-race-evidence.mjs';

const EVIDENCE_ROOT = 'issue-683-evidence';
const JUNIT_SOURCE = join('test-results', 'playwright-results.xml');
const ITERATION_PAD_WIDTH = 2;
const ITERATION_PAD_CHARACTER = '0';
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const FALLBACK_FAILURE_EXIT_CODE = 1;

const candidateSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expectedSha = process.env.GITHUB_SHA?.trim() ?? '';
validateFixedSha(candidateSha, expectedSha);

await rm(EVIDENCE_ROOT, { recursive: true, force: true });
await mkdir(EVIDENCE_ROOT, { recursive: true });

const iterations = [];
let terminalError = null;

for (let iteration = 1; iteration <= ISSUE_683_ITERATION_COUNT; iteration += 1) {
  const iterationName = `iteration-${String(iteration).padStart(ITERATION_PAD_WIDTH, ITERATION_PAD_CHARACTER)}`;
  const iterationDirectory = join(EVIDENCE_ROOT, iterationName);
  const raceEvidencePath = join(iterationDirectory, 'race-evidence.json');
  await mkdir(iterationDirectory, { recursive: true });

  console.log(
    `Issue #683 evidence ${iterationName}/${ISSUE_683_ITERATION_COUNT}: fixed SHA ${candidateSha}, Playwright retries=${ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT}.`
  );

  const result = spawnSync(process.execPath, ['tests/ui/run-real-backend-p0.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIP_ISSUE_683_EVIDENCE: '1',
      AIP_ISSUE_683_EVIDENCE_FILE: relative(process.cwd(), raceEvidencePath)
    },
    stdio: 'inherit'
  });
  const exitCode = Number.isInteger(result.status) ? result.status : FALLBACK_FAILURE_EXIT_CODE;

  if (await fileExists(JUNIT_SOURCE)) {
    await copyFile(JUNIT_SOURCE, join(iterationDirectory, 'playwright-results.xml'));
  }

  const reporterOutput = await readJsonFile(raceEvidencePath);
  const records = Array.isArray(reporterOutput?.records) ? reporterOutput.records : [];
  const parseErrors = records
    .map((record) => record?.parseError)
    .filter((error) => typeof error === 'string' && error.length > 0);
  if (!reporterOutput) {
    parseErrors.push('Issue #683 race evidence reporter output is missing or unreadable.');
  }

  const raceObservationCount = records.reduce(
    (count, record) => count + (Array.isArray(record?.raceObservations) ? record.raceObservations.length : 0),
    0
  );
  const iterationSummary = {
    iteration,
    exitCode,
    pr03cResultCount: records.length,
    pr03cRetries: records.map((record) => record?.retry),
    pr03cStatuses: records.map((record) => record?.status),
    parseErrors,
    raceObservationCount
  };
  iterations.push(iterationSummary);
  await writeJsonFile(join(iterationDirectory, 'summary.json'), iterationSummary);

  const policy = summarizeIssue683IterationsWithPartialAllowance(iterations);
  if (!policy.currentIterationPassed) {
    terminalError = new Error(
      `Issue #683 evidence failed in ${iterationName}; no iteration retry is permitted. See ${iterationDirectory}/summary.json.`
    );
    break;
  }
}

const summary = {
  issue: 683,
  candidateSha,
  fixedShaMatchesGithubSha: candidateSha === expectedSha,
  iterationPolicy: {
    planned: ISSUE_683_ITERATION_COUNT,
    minimumRaceObservationIterations: ISSUE_683_MIN_RACE_OBSERVATION_ITERATIONS,
    playwrightRetries: ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT,
    iterationRetries: 0
  },
  ...summarizeIssue683Iterations(iterations),
  iterations
};
await writeJsonFile(join(EVIDENCE_ROOT, 'summary.json'), summary);
await writeFile(join(EVIDENCE_ROOT, 'summary.md'), renderMarkdownSummary(summary), 'utf8');

if (terminalError) {
  throw terminalError;
}
if (!summary.accepted) {
  throw new Error(
    `Issue #683 evidence conditions were not met: completed=${summary.completedIterations}/${summary.plannedIterations}, race-observed=${summary.raceObservedIterations}/${summary.minimumRaceObservationIterations}. No retries were used.`
  );
}

console.log(
  `Issue #683 evidence accepted for ${candidateSha}: ${summary.completedIterations} clean iterations, retries=0, race observed in ${summary.raceObservedIterations} iteration(s).`
);

function validateFixedSha(actualSha, workflowSha) {
  if (!FULL_COMMIT_SHA.test(actualSha)) {
    throw new Error(`Issue #683 evidence requires a full 40-hex checkout SHA; received ${actualSha || '<empty>'}.`);
  }
  if (!FULL_COMMIT_SHA.test(workflowSha)) {
    throw new Error(`Issue #683 evidence requires GITHUB_SHA to be a full 40-hex SHA; received ${workflowSha || '<empty>'}.`);
  }
  if (actualSha !== workflowSha) {
    throw new Error(`Issue #683 fixed-SHA mismatch: checkout=${actualSha}, GITHUB_SHA=${workflowSha}.`);
  }
}

function summarizeIssue683IterationsWithPartialAllowance(currentIterations) {
  const latest = currentIterations.at(-1);
  const currentIterationPassed = Boolean(
    latest &&
    latest.exitCode === ISSUE_683_REQUIRED_EXIT_CODE &&
    latest.pr03cResultCount === 1 &&
    latest.pr03cRetries.length === 1 &&
    latest.pr03cRetries.every((retry) => retry === ISSUE_683_REQUIRED_PLAYWRIGHT_RETRY_COUNT) &&
    latest.pr03cStatuses.length === 1 &&
    latest.pr03cStatuses.every((status) => status === 'passed') &&
    latest.parseErrors.length === 0
  );
  return { currentIterationPassed };
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function renderMarkdownSummary(summary) {
  const result = summary.accepted ? 'PASS' : 'FAIL';
  return [
    '# Issue #683 real-browser/backend evidence',
    '',
    `- Candidate SHA: \`${summary.candidateSha}\``,
    `- Fixed SHA matches \`GITHUB_SHA\`: ${summary.fixedShaMatchesGithubSha}`,
    `- Planned clean iterations: ${summary.plannedIterations}`,
    `- Completed clean iterations: ${summary.completedIterations}`,
    `- Playwright retries: ${summary.requiredPlaywrightRetries}`,
    '- Iteration retries after failure: 0',
    `- Race observation condition: exact \`GET /api/tasks/{taskId}/execution-scope -> 404\` in at least ${summary.minimumRaceObservationIterations} passing iteration(s)`,
    `- Race-observed iterations: ${summary.raceObservedIterations}`,
    `- Result: **${result}**`,
    ''
  ].join('\n');
}
