import { expect, test } from "@playwright/test";

// The SPA answers for every path the worker doesn't recognise, so an API call
// with the wrong verb, or to a path that never existed, used to come back as
// an HTML page under a 200. Both now answer as an API does, and the pages the
// SPA really owns are untouched.

test("an API path called with the wrong method says which methods it takes", async ({
  request,
}) => {
  const res = await request.get("/api/orgs");

  expect(res.status()).toBe(405);
  expect(res.headers()["allow"]).toBe("POST");
  expect(await res.json()).toEqual({ message: "Method not allowed" });
});

test("an API path that does not exist answers in JSON, not HTML", async ({ request }) => {
  const res = await request.get("/api/nothing-here");

  expect(res.status()).toBe(404);
  expect(res.headers()["content-type"]).toContain("application/json");
  expect(await res.json()).toEqual({ message: "Not found" });
});

test("the app's own routes are still served as pages", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
