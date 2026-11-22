import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Port 3002 was explicitly approved for this isolated run; existing 3001 stays running.
export default defineConfig({
  ...base,
  timeout: 60000,
  testMatch:
    /(?:social-authentication|account-security|shopping-list|shared-session)\.spec\.ts/,
  use: { ...base.use, baseURL: "http://127.0.0.1:3002" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --webpack --port 3002",
    url: "http://127.0.0.1:3002",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      MYSHOPPINGLIST_INTERNAL_API_URL: "", MYSHOPPINGLIST_API_URL: "http://127.0.0.1:5499",
      MYSHOPPINGLIST_PUBLIC_ORIGIN: "http://127.0.0.1:3002",
      MYSHOPPINGLIST_NEXT_DIST_DIR: ".next-social-playwright",
    },
  },
});
