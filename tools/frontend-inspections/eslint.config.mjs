import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import angular from 'angular-eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const frontendRoot = fileURLToPath(new URL('../../frontend/', import.meta.url));
const repoScriptsProject = fileURLToPath(new URL('./tsconfig.repo-scripts.json', import.meta.url));

const ignores = [
  '**/node_modules/**',
  '**/bin/**',
  '**/obj/**',
  '**/dist/**',
  '**/.angular/**',
  '**/coverage/**',
  '**/TestResults/**',
  '**/test-results/**',
  '**/playwright-report/**',
  '**/.playwright/**',
  '**/.qodana/**',
  '**/storybook-static/**',
  'src/AipPortal.Web/wwwroot/**',
  'aipsite-frontend/**'
];

function warningValue(value) {
  if (Array.isArray(value)) {
    return ['warn', ...value.slice(1)];
  }
  if (value === 0 || value === 'off') {
    return value;
  }
  return 'warn';
}

function scope(configs, files, extra = {}) {
  return configs.flat().map((config) => ({
    ...config,
    ...extra,
    files,
    rules: Object.fromEntries(
      Object.entries(config.rules ?? {}).map(([name, value]) => [name, warningValue(value)])
    )
  }));
}

const javascriptFiles = ['**/*.{js,mjs,cjs}'];
const frontendTypeScriptFiles = ['frontend/**/*.ts'];
const repoTypeScriptFiles = ['tests/**/*.ts', '*.ts'];
const angularTemplateFiles = ['frontend/**/*.html'];

export default tseslint.config(
  { ignores },

  ...scope([js.configs.all], javascriptFiles, {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    }
  }),

  ...scope(
    [
      js.configs.all,
      tseslint.configs.all,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsAll
    ],
    frontendTypeScriptFiles
  ),
  {
    files: frontendTypeScriptFiles,
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.spec.json'],
        tsconfigRootDir: frontendRoot
      }
    }
  },

  ...scope(
    [js.configs.all, tseslint.configs.all, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    repoTypeScriptFiles
  ),
  {
    files: repoTypeScriptFiles,
    languageOptions: {
      parserOptions: {
        project: [repoScriptsProject],
        tsconfigRootDir: repoRoot
      }
    }
  },

  ...scope([angular.configs.templateAll], angularTemplateFiles)
);
