import { defineConfig, devices } from "@playwright/test";

const masterKey = Buffer.alloc(32, 5).toString("base64");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:8080", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/reset-e2e-data.mjs && npm run build && npm start",
    url: "http://127.0.0.1:8080/health/ready",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_BASE_URL: "http://127.0.0.1:8080",
      APP_SETUP_SECRET: "e2e-setup-secret-with-more-than-32-characters",
      APP_MASTER_KEY: masterKey,
      DATA_DIR: "./data-e2e",
      COOKIE_SECURE: "false",
      NODE_ENV: "test",
      LOG_LEVEL: "error",
    },
  },
});
