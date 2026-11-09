import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { applyTestMigrations, fetchWorker, overrideEnv } from "./support";

/**
 * App pages answer with `X-Robots-Tag: noindex` (src/worker/noindex.ts), and
 * public pages never do. robots.txt leaves the app pages crawlable on
 * purpose: a crawler that may not fetch a page can still list it, and can
 * never read a noindex on it.
 */

beforeEach(applyTestMigrations);
afterEach(reset);

const SHELL = `<!doctype html><html><head><title>rdyrct</title></head><body><div id="root">app</div></body></html>`;

const assets: Fetcher = {
  fetch: async () =>
    new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8" } }),
  connect: () => {
    throw new Error("ASSETS.connect is not used");
  },
};

const robots = async (path: string) => {
  const res = await fetchWorker(
    new Request(`http://localhost${path}`, { redirect: "manual" }),
    overrideEnv({ ASSETS: assets }),
  );
  return res.headers.get("x-robots-tag");
};

describe("X-Robots-Tag on app pages", () => {
  it.each([
    "/dashboard",
    "/analytics",
    "/links",
    "/links/some-slug",
    "/domains",
    "/members",
    "/organization",
    "/billing",
    "/settings",
    "/api-keys",
    "/import",
    "/admin",
    "/admin/users",
    "/onboarding",
    "/welcome",
    "/reset-password",
    "/invite/abc123",
    "/consent",
  ])("%s is noindex", async (path) => {
    expect(await robots(path)).toBe("noindex");
  });

  it.each(["/", "/pricing", "/login", "/signup", "/utm-builder", "/privacy"])(
    "%s is not noindex",
    async (path) => {
      expect(await robots(path)).toBeNull();
    },
  );
});
