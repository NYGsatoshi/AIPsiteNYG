import { execFileSync } from 'node:child_process';
import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..', '..');
const strict = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const notes = [];

function finding(collection, code, message, file = undefined) {
  collection.push({ code, message, file });
}

function normalize(value) {
  return value.replaceAll('\\', '/');
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
}

async function readText(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

async function exists(relativePath) {
  try {
    await stat(path.join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function validateRequiredPolicyFiles() {
  const requirements = [
    ['LICENSE', /NO LICENSE IS GRANTED/iu, 'no-license declaration'],
    ['CONTRIBUTING.md', /Unsolicited external contributions are not accepted/iu, 'restricted contribution policy'],
    ['THIRD_PARTY_NOTICES.md', /Syncfusion/iu, 'Syncfusion notice'],
    ['docs/PUBLICIZATION_AUDIT.md', /Decision:\s*\*\*BLOCKED/iu, 'explicit audit decision'],
    ['docs/PUBLICIZATION_RUNBOOK.md', /Signed-out validation/iu, 'post-publication validation gate']
  ];

  for (const [relativePath, requiredPattern, description] of requirements) {
    if (!await exists(relativePath)) {
      finding(errors, 'POLICY_MISSING', `Missing required ${description}: ${relativePath}`, relativePath);
      continue;
    }

    const contents = await readText(relativePath);
    if (!requiredPattern.test(contents)) {
      finding(errors, 'POLICY_INCOMPLETE', `${relativePath} does not contain the required ${description}.`, relativePath);
    }
  }
}

async function validateIgnoreBoundary() {
  const relativePath = '.gitignore';
  if (!await exists(relativePath)) {
    finding(errors, 'GITIGNORE_MISSING', '.gitignore is required.', relativePath);
    return;
  }

  const contents = await readText(relativePath);
  const requiredPatterns = [
    /^\.env$/mu,
    /^\.env\.\*$/mu,
    /^secrets\/$/mu,
    /^syncfusion-license\.txt$/mu,
    /^\*\*\/syncfusion-license\.txt$/mu,
    /^\*\*\/syncfusion_license\.txt$/mu
  ];

  for (const requiredPattern of requiredPatterns) {
    if (!requiredPattern.test(contents)) {
      finding(errors, 'GITIGNORE_INCOMPLETE', `.gitignore is missing ${requiredPattern}.`, relativePath);
    }
  }
}

async function validateFrontendPublicationBoundary() {
  const relativePath = 'frontend/package.json';
  if (!await exists(relativePath)) {
    finding(errors, 'FRONTEND_MANIFEST_MISSING', `${relativePath} is missing.`, relativePath);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(await readText(relativePath));
  } catch (error) {
    finding(errors, 'FRONTEND_MANIFEST_INVALID', `${relativePath} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`, relativePath);
    return;
  }

  if (manifest.private !== true) {
    finding(errors, 'NPM_PUBLICATION_RISK', `${relativePath} must keep \"private\": true.`, relativePath);
  }

  if (typeof manifest.license === 'string' && /^(?:MIT|Apache-2\.0|GPL|LGPL|BSD|MPL)/iu.test(manifest.license.trim())) {
    finding(errors, 'LICENSE_METADATA_CONFLICT', `${relativePath} declares an open-source license that conflicts with the repository policy.`, relativePath);
  }
}

function isAllowedEnvironmentExample(relativePath) {
  const lower = normalize(relativePath).toLowerCase();
  return lower.endsWith('.env.example') ||
    lower.endsWith('.env.sample') ||
    lower.endsWith('.env.template') ||
    lower.endsWith('/env.example') ||
    lower.endsWith('/env.sample') ||
    lower.endsWith('/env.template');
}

function suspiciousTrackedPath(relativePath) {
  const normalized = normalize(relativePath);
  const lower = normalized.toLowerCase();
  const base = path.posix.basename(lower);

  if ((base === '.env' || base.startsWith('.env.')) && !isAllowedEnvironmentExample(normalized)) {
    return 'tracked environment file';
  }

  if (/(^|\/)secrets?(\/|$)/u.test(lower)) {
    return 'tracked secrets directory';
  }

  if (/^(?:syncfusion[-_]license)(?:\..*)?$/u.test(base)) {
    return 'tracked Syncfusion license file';
  }

  if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/u.test(base)) {
    return 'tracked SSH private-key filename';
  }

  if (/\.(?:p12|pfx|jks|keystore)$/u.test(base)) {
    return 'tracked private-key or certificate bundle';
  }

  if (/^(?:credentials|service[-_]account)(?:\.[^.]+)?\.json$/u.test(base)) {
    return 'tracked credential file';
  }

  return undefined;
}

async function validateTrackedPathsAndHighConfidenceSecrets() {
  const trackedFiles = git('ls-files', '-z').split('\0').filter(Boolean).map(normalize);

  for (const relativePath of trackedFiles) {
    const reason = suspiciousTrackedPath(relativePath);
    if (reason) {
      finding(errors, 'FORBIDDEN_TRACKED_PATH', `${reason}: ${relativePath}`, relativePath);
    }
  }

  const highConfidencePatterns = [
    ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u],
    ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/u],
    ['GOOGLE_PRIVATE_KEY', /\"private_key\"\s*:\s*\"-----BEGIN PRIVATE KEY-----/u]
  ];

  for (const relativePath of trackedFiles) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    let metadata;
    try {
      metadata = await stat(absolutePath);
    } catch {
      continue;
    }

    if (!metadata.isFile() || metadata.size > 1_500_000) {
      continue;
    }

    let contents;
    try {
      contents = await readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }

    if (contents.includes('\0')) {
      continue;
    }

    for (const [code, pattern] of highConfidencePatterns) {
      if (pattern.test(contents)) {
        finding(errors, code, `High-confidence secret material detected in ${relativePath}. Rotate it before rewriting history.`, relativePath);
      }
    }
  }

  notes.push(`Inspected ${trackedFiles.length} tracked paths. This current-tree check does not replace full-history Gitleaks scanning.`);
}

function workflowHasPullRequestTrigger(source) {
  const jobsIndex = source.search(/^jobs:\s*$/mu);
  const header = jobsIndex >= 0 ? source.slice(0, jobsIndex) : source;
  return /^\s{0,4}pull_request\s*:/mu.test(header) ||
    /^on:\s*\[[^\]]*\bpull_request\b[^\]]*\]/mu.test(header);
}

function workflowJobBlocks(source) {
  const lines = source.split(/\r?\n/u);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  if (jobsIndex < 0) {
    return [];
  }

  const blocks = [];
  let current;
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/u.exec(line);
    if (match) {
      if (current) {
        blocks.push(current);
      }
      current = { name: match[1], lines: [line] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }
  return blocks;
}

function usesSelfHostedRunner(jobSource) {
  return /runs-on:\s*(?:self-hosted|\[[^\]]*\bself-hosted\b)/iu.test(jobSource) ||
    /runs-on:\s*\n(?:\s+-[^\n]*\n)*\s+-\s*self-hosted\b/iu.test(jobSource);
}

function hasSameRepositoryTrustGuard(jobSource) {
  const compact = jobSource.replace(/\s+/gu, ' ');
  return /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/iu.test(compact) ||
    /github\.repository\s*==\s*github\.event\.pull_request\.head\.repo\.full_name/iu.test(compact) ||
    /github\.event_name\s*!=\s*['\"]pull_request['\"]/iu.test(compact) ||
    /github\.event_name\s*==\s*['\"](?:push|workflow_dispatch|schedule)['\"]/iu.test(compact);
}

async function validateWorkflowBoundary() {
  const workflowDirectory = path.join(repositoryRoot, '.github', 'workflows');
  let entries;
  try {
    entries = await readdir(workflowDirectory, { withFileTypes: true });
  } catch (error) {
    finding(errors, 'WORKFLOW_DIRECTORY_MISSING', `Unable to read .github/workflows: ${error instanceof Error ? error.message : String(error)}`, '.github/workflows');
    return;
  }

  let selfHostedPullRequestJobs = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/iu.test(entry.name)) {
      continue;
    }

    const relativePath = `.github/workflows/${entry.name}`;
    const source = await readText(relativePath);

    if (/^\s{0,4}pull_request_target\s*:/mu.test(source) || /^on:\s*\[[^\]]*\bpull_request_target\b[^\]]*\]/mu.test(source)) {
      finding(errors, 'PULL_REQUEST_TARGET', `${relativePath} uses pull_request_target. It requires a separate threat review and is prohibited by the publicization baseline.`, relativePath);
    }

    if (!workflowHasPullRequestTrigger(source)) {
      continue;
    }

    for (const job of workflowJobBlocks(source)) {
      const jobSource = job.lines.join('\n');
      if (!usesSelfHostedRunner(jobSource)) {
        continue;
      }

      selfHostedPullRequestJobs += 1;
      if (!hasSameRepositoryTrustGuard(jobSource)) {
        const message = `${relativePath} job ${job.name} can be selected by pull_request and uses self-hosted without an explicit same-repository trust guard.`;
        if (strict) {
          finding(errors, 'UNTRUSTED_SELF_HOSTED_PR', message, relativePath);
        } else {
          finding(warnings, 'UNTRUSTED_SELF_HOSTED_PR', `${message} Strict publicization mode will fail.`, relativePath);
        }
      }
    }
  }

  notes.push(`Found ${selfHostedPullRequestJobs} pull-request job(s) that reference self-hosted runners; strict mode requires an explicit trust guard for each.`);
}

function emitAnnotation(level, item) {
  const file = item.file ? ` file=${item.file},` : '';
  const command = level === 'error' ? 'error' : 'warning';
  console.log(`::${command}${file}title=${item.code}::${item.message}`);
}

async function writeSummary() {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const lines = [
    '# Publicization readiness audit',
    '',
    `- Mode: ${strict ? 'strict' : 'advisory'}`,
    `- Errors: ${errors.length}`,
    `- Warnings: ${warnings.length}`,
    '',
    '## Findings',
    ''
  ];

  if (errors.length === 0 && warnings.length === 0) {
    lines.push('No current-tree policy finding was detected.');
  } else {
    for (const item of [...errors, ...warnings]) {
      lines.push(`- **${item.code}**${item.file ? ` — \`${item.file}\`` : ''}: ${item.message}`);
    }
  }

  lines.push('', '## Notes', '');
  for (const note of notes) {
    lines.push(`- ${note}`);
  }
  lines.push('', 'A passing current-tree audit does not prove that Git history, Actions logs, artifacts, releases, issues, or external systems are free of sensitive data.', '');

  await appendFile(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  await validateRequiredPolicyFiles();
  await validateIgnoreBoundary();
  await validateFrontendPublicationBoundary();
  await validateTrackedPathsAndHighConfidenceSecrets();
  await validateWorkflowBoundary();

  for (const item of errors) {
    emitAnnotation('error', item);
  }
  for (const item of warnings) {
    emitAnnotation('warning', item);
  }
  for (const note of notes) {
    console.log(`NOTE: ${note}`);
  }

  await writeSummary();

  if (errors.length > 0) {
    console.error(`Publicization readiness audit failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  console.log(`Publicization readiness audit passed in ${strict ? 'strict' : 'advisory'} mode with ${warnings.length} warning(s).`);
}

await main();
