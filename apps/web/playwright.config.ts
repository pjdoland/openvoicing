import { defineConfig, devices } from "@playwright/test";

// Watch mode: `SLOWMO=400 npx playwright test ...` opens a real browser and
// pauses SLOWMO ms between actions so a run is watchable in real time. Off by
// default (and in CI), so normal/headless runs are unaffected.
const slowMo = Number(process.env.SLOWMO) || 0;

// End-to-end tests run against the dev server. They use the locally installed
// Google Chrome (channel: "chrome") because the bundled Chromium download is
// unavailable in this environment; CI installs Chromium instead.
export default defineConfig({
  testDir: "./e2e",
  timeout: slowMo ? 0 : 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    channel: process.env.CI ? undefined : "chrome",
    headless: slowMo ? false : true,
    launchOptions: slowMo ? { slowMo } : {},
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
