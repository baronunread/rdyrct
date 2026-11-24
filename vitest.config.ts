import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // The example's values, not the developer's .dev.vars: every
          // checkout and CI run the worker tests against the same secrets.
          ...parseEnv(readFileSync(".dev.vars.local.example", "utf8")),
          APP_HOST: "localhost",
          APP_URL: "http://localhost",
          SHARED_LINK_HOST: "short.localhost",
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
        },
      },
    })),
  ],
  // rdyrct.com unless VITE_RDYRCT_SITE=0 (`bun run test:worker:self-host`).
  define: {
    "import.meta.env.VITE_RDYRCT_SITE": JSON.stringify(
      process.env.VITE_RDYRCT_SITE === "0" ? "0" : "1",
    ),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      qrcode: fileURLToPath(new URL("./node_modules/qrcode/lib/server.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/worker/**/*.worker.ts"],
  },
});
