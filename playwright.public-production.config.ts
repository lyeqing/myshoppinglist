import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "public-pages.spec.ts", workers: 1, fullyParallel: false, timeout: 90000,
  use: { baseURL: "http://127.0.0.1:3001", screenshot: "only-on-failure" },
  projects: [{ name: "production-desktop", use: { ...devices["Desktop Chrome"] } }, { name: "production-mobile", use: { ...devices["Pixel 7"] } }],
  webServer: { command: "node node_modules/next/dist/bin/next start --port 3001", url: "http://127.0.0.1:3001", reuseExistingServer: false,
    env: { MYSHOPPINGLIST_INTERNAL_API_URL: "", MYSHOPPINGLIST_API_URL: "http://127.0.0.1:5499", MYSHOPPINGLIST_PUBLIC_ORIGIN: "http://127.0.0.1:3001", MYSHOPPINGLIST_NEXT_DIST_DIR: ".next-playwright" } },
});
