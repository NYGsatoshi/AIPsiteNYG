/// <reference types="node" />

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const publicHttpsSmoke = process.env.AIP_PUBLIC_HTTPS_SMOKE === "1";
const expectTimeout = publicHttpsSmoke || process.env.AIP_REAL_BACKEND_SMOKE === "1" ? 15_000 : 5_000;
const snapshotPathTemplate = process.env.CI
  ? "{testDir}/__angular_snapshots__/linux/{testFilePath}/{arg}{ext}"
  : "{testDir}/__angular_snapshots__/{testFilePath}/{arg}{ext}";

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
