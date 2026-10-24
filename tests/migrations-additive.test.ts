import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Migrations add; they do not take away (#310).
 *
 * A deploy runs the migration and then switches the Worker, and
 * `wrangler rollback` brings old code back without touching the schema. So for
 * a while, every time, the previous release runs against the new schema. If a
 * migration dropped or renamed something that release reads, it fails until a
 * Time Travel restore, which also loses every write since.
 *
 * Expand, then contract: add the new shape in one release, move the code over
 * in the next, and drop the old shape only once no deployed release reads it.
 * The drop then carries a line saying so:
 *
 *   -- contract: links.destination unread since v1.2.0
 *
 * This test does not forbid the drop. It makes somebody write that line.
 */

const DIR = new URL("../migrations/", import.meta.url);

/** Migrations up to here predate the rule. 0003, 0008, 0023, 0024, 0028 and
 * 0032 would each have needed the line. */
const LAST_GRANDFATHERED = 41;

const DESTRUCTIVE = /\bdrop\s+(table|column)\b|\brename\b/i;
const CONTRACT = /^[ \t]*--[ \t]*contract:[ \t]*\S/im;

/** The SQL with comments removed, so a comment that mentions a drop is not one. */
function statements(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function needsContractLine(sql: string): boolean {
  return DESTRUCTIVE.test(statements(sql)) && !CONTRACT.test(sql);
}

describe("needsContractLine", () => {
  test("a drop with no contract line fails", () => {
    expect(needsContractLine("ALTER TABLE links DROP COLUMN destination;")).toBe(true);
    expect(needsContractLine("DROP TABLE invites;")).toBe(true);
    expect(needsContractLine("ALTER TABLE user RENAME COLUMN plan TO plan_legacy;")).toBe(true);
  });

  test("the contract line lets it through", () => {
    expect(
      needsContractLine(
        "-- contract: links.destination unread since v1.2.0\nALTER TABLE links DROP COLUMN destination;",
      ),
    ).toBe(false);
  });

  test("an empty contract line does not count", () => {
    expect(needsContractLine("-- contract:\nDROP TABLE invites;")).toBe(true);
  });

  test("additions, indexes and comments pass", () => {
    expect(needsContractLine("ALTER TABLE links ADD COLUMN url TEXT;")).toBe(false);
    expect(needsContractLine("DROP INDEX idx_clicks_dedupe_id;")).toBe(false);
    expect(needsContractLine("-- unlike DROP TABLE user, this keeps rows\nSELECT 1;")).toBe(false);
  });
});

describe("migrations after the rule", () => {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => Number.parseInt(f, 10) > LAST_GRANDFATHERED);

  test.each(files.length ? files : ["(none yet)"])("%s says why it drops or renames", (f) => {
    if (f === "(none yet)") return;
    const sql = readFileSync(new URL(f, DIR), "utf8");
    expect(needsContractLine(sql), `${f} drops or renames with no "-- contract:" line`).toBe(false);
  });
});
