import { expect, test } from "@playwright/test";

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
