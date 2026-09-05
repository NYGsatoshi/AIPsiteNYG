import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import sarifFormatter from '@microsoft/eslint-formatter-sarif';
import stylelint from 'stylelint';

const toolRoot = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = path.resolve(toolRoot, '../..');
const artifactsRoot = path.join(repoRoot, 'artifacts', 'frontend-inspections');
const baselinePath = path.join(toolRoot, 'baseline.json');
const enforce = process.argv.includes('--enforce');
const updateBaseline = process.argv.includes('--update-baseline');
const verbose = process.argv.includes('--verbose');
const baselineVersion = 1;
const baselineStrategy = 'rule-count';
const migrationFixRules = new Set([
  '@angular-eslint/sort-keys-in-type-decorator',
  'sort-imports'
]);

if (enforce && updateBaseline) {
  throw new Error('Use --enforce and --update-baseline separately.');
}

await mkdir(artifactsRoot, { recursive: true });

function countRules(findings) {
  const counts = new Map();
  for (const rule of findings) {
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function findRegressions(currentCounts, baselineCounts) {
  return Object.entries(currentCounts)
    .flatMap(([rule, currentCount]) => {
      const baselineCount = baselineCounts[rule] ?? 0;
      if (currentCount <= baselineCount) {
        return [];
      }
      return [{
        rule,
        currentCount,
        baselineCount,
        delta: currentCount - baselineCount
      }];
    })
    .sort((left, right) => right.delta - left.delta || left.rule.localeCompare(right.rule));
}

function validateCountMap(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Frontend lint baseline contains an invalid ${label} map.`);
  }
  for (const [rule, count] of Object.entries(value)) {
    if (!rule || !Number.isInteger(count) || count < 0) {
      throw new Error(`Frontend lint baseline contains an invalid ${label} entry.`);
    }
  }
  return value;
}

async function loadBaseline() {
  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read frontend lint baseline at ${baselinePath}.`, { cause: error });
  }

  if (baseline.version !== baselineVersion || baseline.strategy !== baselineStrategy) {
    throw new Error(
      `Unsupported frontend lint baseline format: version=${baseline.version}, strategy=${baseline.strategy}`
    );
  }

  return {
    eslint: validateCountMap(baseline.eslint, 'eslint'),
    stylelint: validateCountMap(baseline.stylelint, 'stylelint')
  };
}

function printRegressions(label, regressions) {
  if (regressions.length === 0) {
    return;
  }

  console.error(`${label}: ${regressions.length} rule debt-ceiling regression(s).`);
  for (const regression of regressions.slice(0, 50)) {
    console.error(
      `- ${regression.rule}: +${regression.delta} ` +
        `(current=${regression.currentCount}, baseline=${regression.baselineCount})`
    );
  }
  if (regressions.length > 50) {
    console.error(`- ... ${regressions.length - 50} additional rule regression(s) omitted.`);
  }
}

const baseline = enforce ? await loadBaseline() : null;

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: path.join(toolRoot, 'eslint.config.mjs'),
  errorOnUnmatchedPattern: false,
  fix: (message) => migrationFixRules.has(message.ruleId)
});

const eslintTargets = [
  '**/*.{js,mjs,cjs}',
  'frontend/**/*.ts',
  'tests/**/*.ts',
  '*.ts',
  'frontend/**/*.html'
];
const eslintResults = await eslint.lintFiles(eslintTargets);
const migrationFixes = Object.fromEntries(
  eslintResults
    .filter((result) => typeof result.output === 'string')
    .map((result) => [path.relative(repoRoot, result.filePath), result.output])
);
await writeFile(
  path.join(artifactsRoot, 'migration-fixes.json'),
  JSON.stringify(migrationFixes),
  'utf8'
);
const stylish = await eslint.loadFormatter('stylish');
const stylishOutput = stylish.format(eslintResults);
if (verbose && stylishOutput) {
  console.log(stylishOutput);
}
await writeFile(path.join(artifactsRoot, 'eslint.sarif'), sarifFormatter(eslintResults), 'utf8');

const eslintFatalErrors = eslintResults.flatMap((result) =>
  result.messages
    .filter((message) => message.fatal)
    .map((message) => ({
      filePath: result.filePath,
      line: message.line,
      column: message.column,
      message: message.message
    }))
);
await writeFile(
  path.join(artifactsRoot, 'fatal-errors.json'),
  JSON.stringify(eslintFatalErrors, null, 2),
  'utf8'
);

const eslintFindingRules = eslintResults.flatMap((result) =>
  result.messages
    .filter((message) => !message.fatal)
    .map((message) => message.ruleId ?? '<unknown>')
);
const eslintFatalCount = eslintFatalErrors.length;
const eslintFindingCount = eslintFindingRules.length + eslintFatalCount;

const stylelintResult = await stylelint.lint({
  cwd: repoRoot,
  files: ['**/*.{css,scss}'],
  configFile: path.join(toolRoot, 'stylelint.config.mjs'),
  formatter: 'verbose'
});
if (verbose && stylelintResult.report) {
  console.log(stylelintResult.report);
}
const serializableStylelintResults = stylelintResult.results.map((result) => ({
  source: result.source,
  warnings: result.warnings,
  deprecations: result.deprecations,
  invalidOptionWarnings: result.invalidOptionWarnings,
  parseErrors: result.parseErrors
}));
await writeFile(
  path.join(artifactsRoot, 'stylelint.json'),
  JSON.stringify(serializableStylelintResults, null, 2),
  'utf8'
);

const stylelintFindingRules = stylelintResult.results.flatMap((result) =>
  result.warnings.map((warning) => warning.rule ?? '<unknown>')
);
const stylelintFindingCount = stylelintFindingRules.length;

const currentCounts = {
  eslint: countRules(eslintFindingRules),
  stylelint: countRules(stylelintFindingRules)
};

if (updateBaseline) {
  const nextBaseline = {
    version: baselineVersion,
    strategy: baselineStrategy,
    ...currentCounts
  };
  await writeFile(baselinePath, `${JSON.stringify(nextBaseline)}\n`, 'utf8');
  console.log(`Updated frontend lint baseline: ${baselinePath}`);
}

const eslintRegressions = baseline ? findRegressions(currentCounts.eslint, baseline.eslint) : [];
const stylelintRegressions = baseline
  ? findRegressions(currentCounts.stylelint, baseline.stylelint)
  : [];
const regressionGroupCount = eslintRegressions.length + stylelintRegressions.length;

await writeFile(
  path.join(artifactsRoot, 'summary.json'),
  JSON.stringify(
    {
      mode: updateBaseline ? 'baseline-update' : enforce ? 'enforce' : 'inventory',
      eslintFindings: eslintFindingCount,
      eslintFatalErrors: eslintFatalCount,
      stylelintFindings: stylelintFindingCount,
      baselineRegressionRules: regressionGroupCount
    },
    null,
    2
  ),
  'utf8'
);

console.log(
  `Frontend inspection summary: ESLint=${eslintFindingCount}, Stylelint=${stylelintFindingCount}, ` +
    `baseline regression rules=${regressionGroupCount}, ` +
    `mode=${updateBaseline ? 'baseline-update' : enforce ? 'enforce' : 'inventory'}`
);

if (eslintFatalCount > 0) {
  console.error(`ESLint reported ${eslintFatalCount} fatal parser/configuration error(s).`);
  process.exitCode = 2;
} else if (enforce && regressionGroupCount > 0) {
  printRegressions('ESLint', eslintRegressions);
  printRegressions('Stylelint', stylelintRegressions);
  process.exitCode = 1;
}
