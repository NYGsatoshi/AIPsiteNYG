/// <reference types="node" />

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const publicHttpsSmoke = process.env.AIP_PUBLIC_HTTPS_SMOKE === "1";
const expectTimeout = publicHttpsSmoke || process.env.AIP_REAL_BACKEND_SMOKE === "1" ? 15_000 : 5_000;
const snapshotPathTemplate = process.env.CI
  ? "{testDir}/__angular_snapshots__/linux/{testFilePath}/{arg}{ext}"
  : "{testDir}/__angular_snapshots__/{testFilePath}/{arg}{ext}";

// Issue #361 replaced the embedded two-boolean source-scope smoke with the
// dedicated four-kind tri-state smoke in task-execution-source-policy-v2.spec.ts.
// Keep the obsolete V1 scenario out of the suite rather than asserting a UI
// contract the product no longer exposes; equivalent V2 browser coverage runs
// in both Chromium projects below.
const supersededSourcePolicyV1Smoke =
  /keeps the server-authorized Task execution policy responsive without offering a runtime action$/;

// Issue #363 replaced the embedded #356 Activity placeholder smoke with the
// dedicated authorized Activity/version-history browser smoke. The old test
// intentionally expected no Activity request, which is no longer the product
// contract now that Files exposes a reauthorized File-specific Activity API.
const supersededFileActivityPlaceholderSmoke =
  /keeps one keyboard-accessible File inspector with staged metadata at 320px$/;

const supersededAngularSmokes = new RegExp(
  `${supersededSourcePolicyV1Smoke.source}|${supersededFileActivityPlaceholderSmoke.source}`
);

// Existing Playwright acceptance assertions and screenshot baselines are English.
// Pin that locale explicitly so the product's Japanese default does not rewrite
// unrelated acceptance contracts; locale-specific behavior is tested separately.
const deterministicUiStorageState = {
  cookies: [],
  origins: [
    {
      origin: new URL(baseURL).origin,
      localStorage: [{ name: "aip.locale", value: "en" }]
    }
  ]
};

export default defineConfig({
  testDir: "./tests/ui",
  snapshotPathTemplate,
  timeout: publicHttpsSmoke ? 180_000 : 30_000,
  expect: {
    timeout: expectTimeout
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  grepInvert: supersededAngularSmokes,
  // The public deployment gate intentionally emits no trace, video, screenshot,
  // HTML, or JUnit artifact. Browser-network artifacts can contain session or
  // CSRF material even when the test code never logs those values.
  reporter: publicHttpsSmoke
    ? [["list"]]
    : [
        ["list"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["junit", { outputFile: "test-results/playwright-results.xml" }]
      ],
  use: {
    baseURL,
    storageState: deterministicUiStorageState,
    trace: publicHttpsSmoke ? "off" : "retain-on-failure",
    screenshot: publicHttpsSmoke ? "off" : "only-on-failure",
    video: publicHttpsSmoke ? "off" : "retain-on-failure"
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm --prefix frontend run build && node tests/ui/serve-static.mjs --port ${port}`,
        url: `${baseURL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe"
      },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] }
    }
  ]
});
