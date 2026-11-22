import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: ["ai-connection-journey.spec.ts", "ai-extension-journey.spec.ts"], workers: 1, fullyParallel: false,
  timeout: 180000, expect: { timeout: 15000 },
  use: { baseURL: "http://localhost:3001", screenshot: "only-on-failure", actionTimeout: 20000, navigationTimeout: 30000 },
  webServer: { command: "node node_modules/next/dist/bin/next dev --webpack --port 3001", url: "http://localhost:3001",
    reuseExistingServer: false, timeout: 120000,
    env: { MYSHOPPINGLIST_INTERNAL_API_URL: "", MYSHOPPINGLIST_API_URL: "http://localhost:5392", MYSHOPPINGLIST_PUBLIC_ORIGIN: "http://localhost:3001", MYSHOPPINGLIST_NEXT_DIST_DIR: ".next-playwright" } },
});
