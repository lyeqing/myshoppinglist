import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3002", channel: process.env.PLAYWRIGHT_CHANNEL || undefined, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [ { name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 7"] } } ],
  webServer: { command: "npm run dev -- --port 3002", url: "http://127.0.0.1:3002", reuseExistingServer: false, timeout: 120000,
    env: { MYSHOPPINGLIST_API_URL: "http://127.0.0.1:5499", MYSHOPPINGLIST_PUBLIC_ORIGIN: "http://127.0.0.1:3002", MYSHOPPINGLIST_NEXT_DIST_DIR: ".next-playwright" } }
});
