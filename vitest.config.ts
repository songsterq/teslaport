import { defineConfig } from "vitest/config";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", include: ["tests/shared/**/*.test.ts"], environment: "node" } },
      defineWorkersProject({
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          poolOptions: { workers: { wrangler: { configPath: "./wrangler.jsonc" } } },
        },
      }),
    ],
  },
});
