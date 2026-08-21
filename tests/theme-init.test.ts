/**
 * index.html carries one inline script, the theme bootstrap, and script-src
 * names its sha256 instead of opening up to every inline script. The hash is
 * written by hand in src/worker/security-headers.ts, so it can drift, and the
 * drift is invisible: the dev CSP carries 'unsafe-inline', so locally the
 * script runs either way and only production paints in the wrong theme.
 *
 * Recomputing it here catches that in milliseconds. The browser test in
 * tests/e2e/production/csp.pw.ts is what proves the policy actually works;
 * this is the fast version that says which line to fix.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("the CSP names the hash of the inline theme script", () => {
  const html = readFileSync("index.html", "utf8");
  // A tag with any attribute (the JSON-LD block, the module entry) is a
  // different thing; the browser hashes the bytes between these two.
  const found = html.match(/<script>([\s\S]*?)<\/script>/g) ?? [];
  expect(found.length).toBe(1);
  const script = found[0].slice("<script>".length, -"</script>".length);

  // A matching hash on a script that no longer sets the theme would pass the
  // comparison below and still ship a broken page.
  expect(script).toContain("document.documentElement.dataset.theme");

  const csp = readFileSync("src/worker/security-headers.ts", "utf8");
  const declared = /'(sha256-[A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  expect(declared).toBe(`sha256-${createHash("sha256").update(script).digest("base64")}`);
});
