import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "account-recovery-journey.spec.ts", workers: 1, fullyParallel: false, timeout: 180000,
  expect: { timeout: 15000 }, use: { baseURL: "http://localhost:3001", screenshot: "only-on-failure", trace: "retain-on-failure", actionTimeout: 10000, navigationTimeout: 30000 },
  projects: [{ name: "recovery-desktop", use: { ...devices["Desktop Chrome"] } }, { name: "recovery-mobile", use: { ...devices["Pixel 7"] } }],
  webServer: { command: "node node_modules/next/dist/bin/next start --port 3001", url: "http://localhost:3001", reuseExistingServer: false,
    env: { MYSHOPPINGLIST_API_URL: "http://localhost:5392", MYSHOPPINGLIST_PUBLIC_ORIGIN: "http://localhost:3001", MYSHOPPINGLIST_NEXT_DIST_DIR: ".next-playwright" } },
});
