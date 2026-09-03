const repository = requiredEnv('GITHUB_REPOSITORY');
const sha = requiredEnv('GITHUB_SHA');
const token = requiredEnv('GITHUB_TOKEN');
const apiUrl = process.env.GITHUB_API_URL?.trim() || 'https://api.github.com';

const requiredChecks = [
  'build-test',
  'frontend-test',
  'security-scan',
  'publication-readiness',
  'frontend-static-analysis',
  'licensed-real-backend'
];

const response = await fetch(`${apiUrl}/repos/${repository}/commits/${sha}/check-runs?per_page=100`, {
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'aipsite-mvp-a-final-gate'
  }
});

if (!response.ok) {
  throw new Error(`Unable to read check runs for ${sha}: HTTP ${response.status}.`);
}

const payload = await response.json();
const checkRuns = Array.isArray(payload.check_runs) ? payload.check_runs : [];
const failures = [];
const summary = [];

for (const name of requiredChecks) {
  const matches = checkRuns
    .filter((check) => check?.name === name)
    .sort((left, right) => Date.parse(right.completed_at ?? right.started_at ?? 0) - Date.parse(left.completed_at ?? left.started_at ?? 0));

  const latest = matches[0];
  if (!latest) {
    failures.push(`${name}: no check run exists for ${sha}`);
    summary.push({ name, status: 'missing', conclusion: null, url: null });
    continue;
  }

  summary.push({
    name,
    status: latest.status ?? null,
    conclusion: latest.conclusion ?? null,
    url: latest.html_url ?? null
  });

  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    failures.push(`${name}: status=${latest.status ?? 'unknown'} conclusion=${latest.conclusion ?? 'unknown'}`);
  }
}

console.log('MVP-A final check evidence:');
for (const check of summary) {
  console.log(`- ${check.name}: ${check.status}/${check.conclusion ?? 'none'}${check.url ? ` ${check.url}` : ''}`);
}

if (failures.length > 0) {
  console.error('MVP-A final gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`MVP-A final gate passed: ${requiredChecks.length} required checks are green for ${sha}.`);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for MVP-A final check verification.`);
  return value;
}
