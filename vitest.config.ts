import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          APP_HOST: "localhost",
          APP_URL: "http://localhost",
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
        },
        // A one-token click bucket makes the redirect fail-open behavior
        // deterministic without weakening production's 600/min threshold.
        ratelimits: {
          RL_CLICK_RECORDING: {
            namespace_id: "14008",
            simple: { limit: 1, period: 60 },
          },
        },
      },
    })),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/worker/**/*.worker.ts"],
  },
});
