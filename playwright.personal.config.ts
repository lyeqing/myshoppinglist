import { defineConfig } from "@playwright/test";

// Separate from the mock-API suite. The journey owns a real API on 5392 and
// creates/removes only its own PostgreSQL schema and temporary Chrome profile.
export default defineConfig({
  testDir: "./tests",
  testMatch: "personal-capture-journey.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240000,
  expect: { timeout: 15000 },
  use: { baseURL: "http://localhost:3001", actionTimeout: 20000, navigationTimeout: 30000 },
  projects: [{ name: "personal-chromium" }],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --webpack --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      MYSHOPPINGLIST_API_URL: "http://localhost:5392",
      MYSHOPPINGLIST_PUBLIC_ORIGIN: "http://localhost:3001",
      // Already included in tsconfig.json; Next must not rewrite that file.
      MYSHOPPINGLIST_NEXT_DIST_DIR: ".next-playwright",
    },
  },
});
