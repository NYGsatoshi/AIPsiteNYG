import { buildPlaywrightGrep } from '../../scripts/ci/build-playwright-grep.mjs';

const manifestUrl = new URL('../../scripts/ci/real-backend-pr-p0-required-tests.txt', import.meta.url);
const specUrl = new URL('./real-backend-smoke.spec.ts', import.meta.url);

process.env.AIP_REAL_BACKEND_SMOKE_GREP = await buildPlaywrightGrep(manifestUrl, {
  verifyPath: specUrl
});
process.env.AIP_REAL_BACKEND_SMOKE_SCOPE = 'PR P0 required set';

await import('./run-real-backend-smoke-compose.mjs');
