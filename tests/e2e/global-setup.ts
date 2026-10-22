import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FullConfig } from "@playwright/test";

/** The Explorer API of the server this config tests: `vite dev` for the main
 *  suite, the self-hosted `vite preview` for playwright.self-host.config.ts.
 *  Both start with an empty, in-memory D1 under PLAYWRIGHT_TEST. */
function explorerFor(config: FullConfig): string {
  return `${config.projects[0].use.baseURL}/cdn-cgi/explorer/api`;
}

export default async function globalSetup(config: FullConfig) {
  const explorerUrl = explorerFor(config);
  const databases = await fetch(`${explorerUrl}/d1/database`).then((response) => response.json());
  const databaseId = databases.result.find(
    (database: { name: string }) => database.name === "DB",
  )?.uuid;
  if (!databaseId) throw new Error("Could not find the local DB binding");

  const migrationsDir = path.join(import.meta.dirname, "../../migrations");
  const migrationNames = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migrationName of migrationNames) {
    const source = await readFile(path.join(migrationsDir, migrationName), "utf8");
    const queries = source
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean);
    const response = await fetch(`${explorerUrl}/d1/database/${databaseId}/raw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batch: queries.map((sql) => ({ sql })) }),
    });
    if (!response.ok) {
      throw new Error(`Could not apply migration ${migrationName}: ${await response.text()}`);
    }
  }
}
