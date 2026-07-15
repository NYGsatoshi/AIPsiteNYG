import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import sarifFormatter from '@microsoft/eslint-formatter-sarif';
import stylelint from 'stylelint';

const toolRoot = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = path.resolve(toolRoot, '../..');
const artifactsRoot = path.join(repoRoot, 'artifacts', 'frontend-inspections');
const enforce = process.argv.includes('--enforce');
const verbose = enforce || process.argv.includes('--verbose');

await mkdir(artifactsRoot, { recursive: true });

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: path.join(toolRoot, 'eslint.config.mjs'),
  errorOnUnmatchedPattern: false
});

const eslintTargets = [
  '**/*.{js,mjs,cjs}',
  'frontend/**/*.ts',
  'tests/**/*.ts',
  '*.ts',
  'frontend/**/*.html'
];
const eslintResults = await eslint.lintFiles(eslintTargets);
const stylish = await eslint.loadFormatter('stylish');
const stylishOutput = stylish.format(eslintResults);
if (verbose && stylishOutput) {
  console.log(stylishOutput);
}
await writeFile(path.join(artifactsRoot, 'eslint.sarif'), sarifFormatter(eslintResults), 'utf8');

const eslintFatalCount = eslintResults.reduce((sum, result) => sum + result.fatalErrorCount, 0);
const eslintFindingCount = eslintResults.reduce(
  (sum, result) => sum + result.errorCount + result.warningCount,
  0
);

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

const stylelintFindingCount = stylelintResult.results.reduce(
  (sum, result) => sum + result.warnings.length,
  0
);

await writeFile(
  path.join(artifactsRoot, 'summary.json'),
  JSON.stringify(
    {
      mode: enforce ? 'enforce' : 'inventory',
      eslintFindings: eslintFindingCount,
      eslintFatalErrors: eslintFatalCount,
      stylelintFindings: stylelintFindingCount
    },
    null,
    2
  ),
  'utf8'
);

console.log(
  `Frontend inspection summary: ESLint=${eslintFindingCount}, Stylelint=${stylelintFindingCount}, mode=${
    enforce ? 'enforce' : 'inventory'
  }`
);

if (eslintFatalCount > 0) {
  console.error(`ESLint reported ${eslintFatalCount} fatal parser/configuration error(s).`);
  process.exitCode = 2;
} else if (enforce && eslintFindingCount + stylelintFindingCount > 0) {
  process.exitCode = 1;
}
