/**
 * The theme bootstrap is inline in index.html and allowed by a sha256 named
 * in the CSP, in two places: src/worker/security-headers.ts (every response
 * the Worker sends) and public/_headers (the one prefix Cloudflare serves
 * without the Worker).
 *
 * Nothing computes that hash at build time on purpose: a plugin doing it
 * would be one more moving part in front of the first paint. The cost of
 * writing it by hand is that it can drift, and the drift is invisible
 * locally, because the dev CSP carries 'unsafe-inline' and the browser runs
 * the script either way. In production the browser refuses it and every page
 * paints in the wrong theme first.
 *
 * So this recomputes it from the file and fails on the spot. Reindenting the
 * block, changing a variable name, or updating one CSP and not the other all
 * land here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const html = readFileSync("index.html", "utf8");
const workerCsp = readFileSync("src/worker/security-headers.ts", "utf8");
const staticCsp = readFileSync("public/_headers", "utf8");

/** The inline script's exact bytes: what the browser hashes. A tag with any
 *  attribute (the JSON-LD block, the module entry) is a different thing. */
function inlineScript(): string {
  const found = html.match(/<script>([\s\S]*?)<\/script>/g) ?? [];
  expect(found.length, "index.html should carry exactly one attribute-less script").toBe(1);
  return found[0].slice("<script>".length, -"</script>".length);
}

/** The sha256 a CSP source names, so a mismatch prints two short hashes
 *  rather than the whole file it was found in. */
function declaredHash(source: string): string {
  return /'(sha256-[A-Za-z0-9+/=]+)'/.exec(source)?.[1] ?? "no sha256 in this file";
}

describe("the inline theme bootstrap", () => {
  const hash = `sha256-${createHash("sha256").update(inlineScript()).digest("base64")}`;

  test("is allowed by the Worker's CSP", () => {
    expect(declaredHash(workerCsp)).toBe(hash);
  });

  test("is allowed by the CSP on the assets Cloudflare serves directly", () => {
    expect(declaredHash(staticCsp)).toBe(hash);
  });

  test("still does the one thing it is there for", () => {
    // A hash that matches a script which no longer sets the theme passes the
    // two checks above and still ships a broken page.
    const script = inlineScript();
    expect(script).toContain("document.documentElement.dataset.theme");
    expect(script).toContain('localStorage.getItem("theme")');
    expect(script).toContain("prefers-color-scheme: dark");
  });

  test("is not also sitting in public/, where nothing would load it", () => {
    // It used to be public/theme-init.js. Leaving that behind means two
    // copies, one of them dead and free to disagree with the live one.
    expect(() => readFileSync("public/theme-init.js")).toThrow();
  });
});
