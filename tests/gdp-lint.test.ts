import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("..", import.meta.url));

function lint(source: string, filename = "src/worker/spike-invalid.ts") {
  const fixture = join(root, filename.replace(".ts", `-${randomUUID()}.ts`));
  writeFileSync(fixture, source);
  try {
    return spawnSync("./node_modules/.bin/oxlint", [fixture], { cwd: root, encoding: "utf8" });
  } finally {
    unlinkSync(fixture);
  }
}

describe("authorization proof lint integration", () => {
  const importProof = 'import type { OrgDeletion } from "./proofs/can-delete-org";';
  for (const source of [
    `${importProof} const proof = {} as OrgDeletion<string, string>;`,
    `${importProof} let proof!: OrgDeletion<string, string>;`,
    `${importProof} declare const proof: OrgDeletion<string, string>;`,
    "const proof = null!;",
    "const proof: any = {};",
  ]) {
    it(`rejects forged evidence: ${source}`, () => {
      const result = lint(source);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("gdp-ts");
    });
  }
  it("rejects an unchecked prover outside the trusted directory", () => {
    const result = lint(
      'import { defineProof } from "@gdp-ts/core"; const prover = defineProof("Fake");',
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("no-define-proof");
  });
  it("rejects exporting the trusted prover", () => {
    const result = lint(
      'import { defineProof } from "@gdp-ts/core"; export const prover = defineProof("Fake");',
      "src/worker/proofs/spike-invalid.ts",
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("no-exported-prover");
  });
});
