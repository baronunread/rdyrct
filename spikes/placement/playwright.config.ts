import { defineConfig } from "@playwright/test";

if (!process.env.BENCH_SECRETS_FILE)
  throw new Error("BENCH_SECRETS_FILE is required for the live preview suite");

export default defineConfig({
  testDir: "../../tests/e2e",
  testMatch: "placement-preview.pw.ts",
  workers: 1,
  timeout: 30_000,
  reporter: "list",
});
