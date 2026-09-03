const EMPTY_COUNT = Number('0'),
  FAILURE_EXIT_CODE = Number('1'),
  requiredEnv = (name) => {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required for MVP-A final check verification.`);
    }
    return value;
  },
  checkTimestamp = (check) => Date.parse(check.completed_at ?? check.started_at ?? '1970-01-01T00:00:00Z'),
  main = async () => {
    const repository = requiredEnv('GITHUB_REPOSITORY'),
      sha = requiredEnv('GITHUB_SHA'),
      token = requiredEnv('GITHUB_TOKEN'),
      apiUrl = process.env.GITHUB_API_URL?.trim() || 'https://api.github.com',
      requiredChecks = [
        'build-test',
        'frontend-test',
        'security-scan',
        'publication-readiness',
        'frontend-static-analysis',
        'licensed-real-backend'
      ],
      response = await fetch(`${apiUrl}/repos/${repository}/commits/${sha}/check-runs?per_page=100`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'aipsite-mvp-a-final-gate',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

    if (!response.ok) {
      throw new Error(`Unable to read check runs for ${sha}: HTTP ${response.status}.`);
    }

    {
      const payload = await response.json(),
        failures = [],
        summary = [];
      let checkRuns = [];

      if (Array.isArray(payload.check_runs)) {
        checkRuns = payload.check_runs;
      }

      for (const name of requiredChecks) {
        const matches = checkRuns
            .filter((check) => check?.name === name)
            .sort((left, right) => checkTimestamp(right) - checkTimestamp(left)),
          [latest] = matches;

        if (!latest) {
          failures.push(`${name}: no check run exists for ${sha}`);
          summary.push({ conclusion: null, name, status: 'missing', url: null });
        } else {
          summary.push({
            conclusion: latest.conclusion ?? null,
            name,
            status: latest.status ?? null,
            url: latest.html_url ?? null
          });

          if (latest.status !== 'completed' || latest.conclusion !== 'success') {
            failures.push(`${name}: status=${latest.status ?? 'unknown'} conclusion=${latest.conclusion ?? 'unknown'}`);
          }
        }
      }

      process.stdout.write('MVP-A final check evidence:\n');
      for (const check of summary) {
        let line = `- ${check.name}: ${check.status}/${check.conclusion ?? 'none'}`;
        if (check.url) {
          line += ` ${check.url}`;
        }
        process.stdout.write(`${line}\n`);
      }

      if (failures.length > EMPTY_COUNT) {
        process.stderr.write(`MVP-A final gate failed:\n- ${failures.join('\n- ')}\n`);
        process.exitCode = FAILURE_EXIT_CODE;
      } else {
        process.stdout.write(`MVP-A final gate passed: ${requiredChecks.length} required checks are green for ${sha}.\n`);
      }
    }
  };

await main();
