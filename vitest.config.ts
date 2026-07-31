import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "shared", include: ["tests/shared/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "worker", include: ["tests/worker/**/*.test.ts"] },
      },
    ],
  },
});
