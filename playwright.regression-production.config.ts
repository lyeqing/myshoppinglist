import { defineConfig } from "@playwright/test";
import regression from "./playwright.config";

// Same customer/admin regression cases, served from the built release assets.
// Keep development-run failure evidence in the parent test-results directory.
export default defineConfig({
  ...regression,
  outputDir: "./test-results/production",
  reporter: [["line"], ["json", { outputFile: "test-results/release-production.json" }]],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --port 3001",
    url: "http://127.0.0.1:3001", reuseExistingServer: false, timeout: 120000,
    env: {
      MYSHOPPINGLIST_API_URL: "http://127.0.0.1:5499",
      MYSHOPPINGLIST_PUBLIC_ORIGIN: "http://127.0.0.1:3001",
      MYSHOPPINGLIST_NEXT_DIST_DIR: ".next-playwright",
    },
  },
});
