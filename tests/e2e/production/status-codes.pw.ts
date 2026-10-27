import { expect, test } from "@playwright/test";

/**
 * What status a crawler reads for an address, from the built Worker and the
 * real asset bundle. The worker tests stub ASSETS, so this is where the
 * shell's real headers meet the 404 (src/shared/spa-routes.ts).
 *
 * A path the SPA has no page for used to come back 200 with the landing
 * page's title and canonical: a soft 404 Google counted against the site.
 */

test("an address with no page is a 404 that still shows the NotFound screen", async ({
  page,
  request,
}) => {
  const res = await request.get("/some/deep/path", { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  expect(res.headers()["cache-control"]).toBe("no-store");

  await page.goto("/some/deep/path");
  await expect(
    page.getByRole("heading", { level: 1, name: "Nothing lives at this link." }),
  ).toBeVisible();
});

test("a known page asked for in capitals moves to its real address", async ({ request }) => {
  const res = await request.get("/PRICING", { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  expect(new URL(res.headers()["location"]).pathname).toBe("/pricing");

  const link = await request.get("/LINKS/AbC", { maxRedirects: 0 });
  expect(new URL(link.headers()["location"]).pathname).toBe("/links/AbC");
});

test("every kind of page the app has still answers 200", async ({ request }) => {
  for (const path of [
    "/",
    "/pricing",
    "/login",
    "/dashboard",
    "/links/abc",
    "/invite/x",
    "/admin/users",
  ]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), `status of ${path}`).toBe(200);
  }
});

test("a trailing slash still moves to the slash-free page", async ({ request }) => {
  const res = await request.get("/pricing/", { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  expect(new URL(res.headers()["location"], res.url()).pathname).toBe("/pricing");
});

/**
 * The dev-only account scenarios (src/worker/dev-scenarios.ts) are not in a
 * built Worker at all: index.ts mounts them under import.meta.env.DEV, a
 * build-time constant. If that fence ever slipped, this address would sign
 * strangers in as seeded accounts on a real deployment.
 */
test("the dev scenario switcher does not exist in a built Worker", async ({ request }) => {
  // Not only unrouted: the code itself must be gone. A static import once
  // kept the whole module (seed password included) in the bundle while the
  // route still answered 404.
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = "dist/rdyrct";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js")))
    expect(readFileSync(`${dir}/${file}`, "utf8"), file).not.toContain("seed-password-123");

  for (const path of ["/__dev/scenarios", "/__dev/scenarios/pro-owner"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
    expect(res.headers()["set-cookie"] ?? "", path).not.toContain("session");
  }
});
