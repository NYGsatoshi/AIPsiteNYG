# Frontend inspections

This isolated toolchain provides broad static-analysis coverage without changing the active Angular application's dependency lockfile.

Coverage:

- JavaScript: all ESLint core rules.
- TypeScript and Playwright TypeScript: all typescript-eslint rules plus strict and stylistic typed profiles.
- Angular TypeScript: all Angular ESLint TypeScript rules, including inline templates.
- Angular HTML templates: all Angular ESLint template rules, including accessibility rules.
- CSS and SCSS: the coherent Stylelint standard SCSS profile.

The default CI mode is inventory mode: all configured rules run and reports are uploaded, but existing findings do not fail the build. Fatal parser/configuration errors still fail. Run with `--enforce` to fail on any finding after the existing backlog has been baselined or fixed.

```bash
npm ci
npm ci --prefix frontend
npm install --prefix tools/frontend-inspections
node tools/frontend-inspections/run.mjs
node tools/frontend-inspections/run.mjs --verbose
node tools/frontend-inspections/run.mjs --enforce
```
