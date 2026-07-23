import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const explorerUrl = "http://localhost:5173/cdn-cgi/explorer/api";

export default async function globalSetup() {
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
