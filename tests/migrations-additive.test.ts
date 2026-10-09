import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// Deploys run migrations before the new Worker lands, so the old Worker must
// survive the new schema. Drop or rename in a later release (expand/contract),
// or mark the line `-- allow-destructive` after checking nothing reads it.
const LAST_GRANDFATHERED = 35;

test("new migrations are additive", () => {
  const bad = readdirSync("migrations")
    .filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) > LAST_GRANDFATHERED)
    .flatMap((f) =>
      readFileSync(`migrations/${f}`, "utf8")
        .split("\n")
        .filter((l) => /\b(drop\s+(table|column|index)|rename\s+(to|column))\b/i.test(l))
        .filter((l) => !l.includes("allow-destructive"))
        .map((l) => `${f}: ${l.trim()}`),
    );
  expect(bad).toEqual([]);
});
