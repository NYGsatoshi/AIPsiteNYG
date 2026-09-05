import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const angularJson = JSON.parse(await readFile(new URL('../angular.json', import.meta.url), 'utf8'));

const expectedDependencies = {
  '@lucide/angular': '1.27.0',
  '@microsoft/signalr': '10.0.0',
  '@syncfusion/ej2-angular-gantt': '34.1.30',
  '@syncfusion/ej2-angular-grids': '34.1.33',
  '@syncfusion/ej2-angular-inputs': '34.1.32',
  '@syncfusion/ej2-angular-popups': '34.1.29',
  'ag-grid-angular': '36.0.2',
  'ag-grid-community': '36.0.2',
  rxjs: '7.8.2',
  'zone.js': '0.16.2',
};

const expectedDevDependencies = {
  '@angular-devkit/build-angular': '22.1.7',
  '@storybook/angular': '10.5.5',
  jsdom: '28.0.0',
  storybook: '10.5.5',
  vitest: '4.1.10',
};

test('keeps the reviewed Angular 22 third-party versions pinned', () => {
  for (const [name, version] of Object.entries(expectedDependencies)) {
    assert.equal(packageJson.dependencies[name], version, `${name} drifted from the ANG22-06 reviewed version`);
  }
  for (const [name, version] of Object.entries(expectedDevDependencies)) {
    assert.equal(packageJson.devDependencies[name], version, `${name} drifted from the ANG22-06 reviewed version`);
  }
});

test('retains the Angular Storybook browser builder and zone.js runtime', () => {
  const architect = angularJson.projects.frontend.architect;
  const browserTarget = architect['storybook-browser'];
  const storybookTarget = architect.storybook;
  const buildStorybookTarget = architect['build-storybook'];

  assert.equal(browserTarget.builder, '@angular-devkit/build-angular:browser');
  assert.deepEqual(browserTarget.options.polyfills, ['zone.js']);
  assert.equal(storybookTarget.options.browserTarget, 'frontend:storybook-browser');
  assert.equal(buildStorybookTarget.options.browserTarget, 'frontend:storybook-browser');
  assert.equal(storybookTarget.options.compodoc, false);
  assert.equal(buildStorybookTarget.options.compodoc, false);
});

test('retains Syncfusion license and theme sanitation gates', () => {
  assert.match(packageJson.scripts['syncfusion:activate'], /require-syncfusion-license\.mjs/u);
  assert.match(packageJson.scripts['build-storybook'], /sanitize-syncfusion-theme-css\.mjs/u);

  const assets = angularJson.projects.frontend.architect.build.options.assets;
  const assetInputs = assets.map((asset) => typeof asset === 'string' ? asset : asset.input);
  for (const requiredInput of [
    'node_modules/@syncfusion/ej2-base/styles',
    'node_modules/@syncfusion/ej2-grids/styles',
    'node_modules/@syncfusion/ej2-popups/styles',
    'node_modules/@syncfusion/ej2-gantt/styles',
  ]) {
    assert.equal(assetInputs.includes(requiredInput), true, `${requiredInput} is missing from the production asset contract`);
  }
});

test('keeps the Angular 22 Vitest runner contract on the reviewed jsdom toolchain', () => {
  const testTarget = angularJson.projects.frontend.architect.test;

  assert.equal(testTarget.builder, '@angular/build:unit-test');
  assert.equal(testTarget.options.runnerConfig, 'vitest.config.ts');
});
