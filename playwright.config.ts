import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  use: { baseURL: "http://localhost:8787" },
  webServer: {
    command: "npm run build && npx wrangler dev --port 8787",
    url: "http://localhost:8787/",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
