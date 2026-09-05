import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const parentSha = 'f78c0cd5794cbb88e3774f5be5a70d6272bb47ba';
const componentRoots = ['frontend/src', 'aipsite-frontend/src'];
const temporaryFiles = [
  '.github/workflows/ang22-normalize.yml',
  'scripts/ci/ang22-normalize.mjs',
  'tools/frontend-inspections/ang22-source-snapshot.mjs',
];
const restoreFiles = [
  'frontend/tsconfig.app.json',
  'frontend/tsconfig.spec.json',
  'aipsite-frontend/tsconfig.app.json',
  'aipsite-frontend/tsconfig.spec.json',
  'tools/frontend-inspections/package.json',
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function parentFile(filePath) {
  return git(['show', `${parentSha}:${filePath}`]);
}

function localName(specifier) {
  const normalized = specifier.replace(/^type\s+/, '').trim();
  const alias = normalized.match(/\s+as\s+([A-Za-z_$][\w$]*)$/u);
  return alias?.[1] ?? normalized;
}

function addChangeDetectionImport(source, filePath) {
  const pattern = /import\s*\{[^;]*?\}\s*from\s*['"]@angular\/core['"];/su;
  const match = pattern.exec(source);
  if (!match) {
    throw new Error(`Angular core import not found: ${filePath}`);
  }
  const statement = match[0];
  const left = statement.indexOf('{');
  const right = statement.lastIndexOf('}');
  const inside = statement.slice(left + 1, right);
  const specifiers = inside
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (specifiers.some((value) => localName(value) === 'ChangeDetectionStrategy')) {
    throw new Error(`Parent already imports ChangeDetectionStrategy: ${filePath}`);
  }

  specifiers.push('ChangeDetectionStrategy');
  specifiers.sort((a, b) => {
    const leftName = localName(a);
    const rightName = localName(b);
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });

  let replacementInside;
  if (inside.includes('\n')) {
    const firstContentLine = inside.split('\n').find((line) => line.trim());
    const indent = firstContentLine?.match(/^\s*/u)?.[0] ?? '  ';
    replacementInside = `\n${specifiers.map((value) => `${indent}${value},`).join('\n')}\n`;
  } else {
    replacementInside = ` ${specifiers.join(', ')} `;
  }

  const replacement =
    statement.slice(0, left + 1) + replacementInside + statement.slice(right);
  return source.slice(0, match.index) + replacement + source.slice(match.index + statement.length);
}

function addEagerProperty(source, filePath) {
  const componentIndex = source.indexOf('@Component({');
  const classIndex = source.indexOf('export class', componentIndex);
  if (componentIndex < 0 || classIndex < 0) {
    throw new Error(`Component decorator/class not found: ${filePath}`);
  }
  const closeIndex = source.lastIndexOf('})', classIndex);
  if (closeIndex < componentIndex) {
    throw new Error(`Component decorator close not found: ${filePath}`);
  }

  const before = source.slice(0, closeIndex);
  const trailingWhitespace = before.match(/\s*$/u)?.[0] ?? '';
  let body = before.slice(0, before.length - trailingWhitespace.length);
  if (!body.endsWith(',')) {
    body += ',';
  }

  return `${body}\n  changeDetection: ChangeDetectionStrategy.Eager\n${source.slice(closeIndex)}`;
}

function transformComponent(source, filePath) {
  return addEagerProperty(addChangeDetectionImport(source, filePath), filePath);
}

const changedPaths = git(['diff', '--name-only', parentSha, 'HEAD', '--', ...componentRoots])
  .split('\n')
  .map((value) => value.trim())
  .filter(Boolean);

const eagerPaths = changedPaths.filter(
  (filePath) =>
    filePath.endsWith('.ts') &&
    existsSync(filePath) &&
    readFileSync(filePath, 'utf8').includes('ChangeDetectionStrategy.Eager'),
);

if (eagerPaths.length !== 117) {
  throw new Error(`Expected 117 Eager migration files, found ${eagerPaths.length}`);
}

for (const filePath of eagerPaths) {
  const transformed = transformComponent(parentFile(filePath), filePath);
  if ((transformed.match(/ChangeDetectionStrategy\.Eager/gu) ?? []).length !== 1) {
    throw new Error(`Unexpected Eager count after normalization: ${filePath}`);
  }
  writeFileSync(filePath, transformed, 'utf8');
}

const appConfigPath = 'frontend/src/app/app.config.ts';
const appConfig = parentFile(appConfigPath)
  .replace(
    "import { provideHttpClient, withInterceptors } from '@angular/common/http';",
    "import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';",
  )
  .replace(
    'provideHttpClient(withInterceptors([authSessionInterceptor]))',
    'provideHttpClient(withXhr(), withInterceptors([authSessionInterceptor]))',
  );
if (!appConfig.includes('withXhr()')) {
  throw new Error('withXhr migration missing from app.config.ts');
}
writeFileSync(appConfigPath, appConfig, 'utf8');

const topBarStoryPath = 'frontend/src/app/layout/top-bar/top-bar.stories.ts';
const topBarStory = parentFile(topBarStoryPath)
  .replace(
    "import { provideHttpClient } from '@angular/common/http';",
    "import { provideHttpClient, withXhr } from '@angular/common/http';",
  )
  .replace('provideHttpClient()]', 'provideHttpClient(withXhr())]');
if (!topBarStory.includes('provideHttpClient(withXhr())')) {
  throw new Error('withXhr migration missing from top-bar story');
}
writeFileSync(topBarStoryPath, topBarStory, 'utf8');

for (const filePath of restoreFiles) {
  writeFileSync(filePath, parentFile(filePath), 'utf8');
}

for (const filePath of temporaryFiles) {
  rmSync(filePath, { force: true });
}

console.log(`Normalized ${eagerPaths.length} Angular components and restored compatibility config.`);
