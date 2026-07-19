import { defineConfig } from "drizzle-kit";

// Used only for generating future migrations against the schema:
//   bunx drizzle-kit generate
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
});
