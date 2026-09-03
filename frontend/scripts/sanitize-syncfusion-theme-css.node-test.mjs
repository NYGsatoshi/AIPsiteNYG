import assert from 'node:assert/strict';
import test from 'node:test';

import { stripExternalGoogleFontImports } from './sanitize-syncfusion-theme-css.mjs';

test('removes unquoted Google Fonts imports without changing local theme rules', () => {
  const source = [
    '@import url(https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap);',
    '@import "./local-overrides.css";',
    '.e-control { font-family: Roboto, sans-serif; }'
  ].join('\n');

  const sanitized = stripExternalGoogleFontImports(source);

  assert.equal(sanitized.includes('fonts.googleapis.com'), false);
  assert.equal(sanitized.includes('@import "./local-overrides.css";'), true);
  assert.equal(sanitized.includes('font-family: Roboto, sans-serif'), true);
});

test('removes every quoted Google Fonts import in a minified theme', () => {
  const source = '@import url("https://fonts.googleapis.com/css?family=Roboto:300,400");@import \'https://fonts.googleapis.com/icon?family=Material+Icons\';.e-grid{display:block}';

  const sanitized = stripExternalGoogleFontImports(source);

  assert.equal(sanitized, '.e-grid{display:block}');
});
