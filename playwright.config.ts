/// <reference types="node" />

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const expectTimeout = process.env.AIP_REAL_BACKEND_SMOKE === "1" ? 15_000 : 5_000;
const snapshotPathTemplate = process.env.CI
  ? "{testDir}/__angular_snapshots__/linux/{testFilePath}/{arg}{ext}"
  : "{testDir}/__angular_snapshots__/{testFilePath}/{arg}{ext}";

export default defineConfig({
  testDir: "./tests/ui",
  snapshotPathTemplate,
  timeout: 30_000,
  expect: {
    timeout: expectTimeout
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/playwright-results.xml" }]
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
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