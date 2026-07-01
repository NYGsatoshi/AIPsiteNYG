import { test } from '@playwright/test';

test.describe.skip('legacy static SPA Playwright coverage', () => {
  test('obsolete after the MVP-A P0 Angular frontend migration', async () => {
    // The previous tests targeted the removed vanilla JavaScript SPA in
    // src/AipPortal.Web/wwwroot. Add Angular-facing Playwright coverage in a
    // follow-up after the Angular dependencies and routes are in place.
  });
});
