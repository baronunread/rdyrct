import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../tests/e2e",
  testMatch: "placement-preview.pw.ts",
  workers: 1,
  timeout: 30_000,
  reporter: "list",
});
