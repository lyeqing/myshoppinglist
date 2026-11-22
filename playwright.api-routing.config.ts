import { defineConfig, devices } from "@playwright/test";

// Two distinct fake upstreams prove that server requests bypass the public route.
export default defineConfig({
  testDir: "./tests", testMatch: ["api-routing.spec.ts", "auth-availability.spec.ts", "social-authentication.spec.ts"],
  workers: 1, fullyParallel: false, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3001", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: process.env.MYSHOPPINGLIST_ROUTING_TEST_MODE === "development"
      ? "node node_modules/next/dist/bin/next dev --webpack --port 3001"
      : "node node_modules/next/dist/bin/next start --port 3001",
    url: "http://127.0.0.1:3001", reuseExistingServer: false, timeout: 120000,
    env: {
      MYSHOPPINGLIST_INTERNAL_API_URL: "http://127.0.0.1:5499",
      MYSHOPPINGLIST_API_URL: "http://127.0.0.1:5500",
      MYSHOPPINGLIST_PUBLIC_ORIGIN: "http://127.0.0.1:3001",
      MYSHOPPINGLIST_NEXT_DIST_DIR: ".next-api-routing",
    },
  },
});
