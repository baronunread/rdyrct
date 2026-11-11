import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

// A request that fails is not an answer (#487). A 5xx on /user is not a
// sign-out, and a 5xx on a list is not an empty org: each says it failed and
// offers Retry, which recovers once the server answers again.

const fail = (page: Page, url: RegExp) =>
  page.route(url, (route) => route.fulfill({ status: 500, json: { error: "boom" } }));

test("a failed /user keeps you signed in and offers Retry", async ({ page }) => {
  await signUpAndVerify(page, `failed-user-${Date.now()}@gmail.com`, password);

  await fail(page, /\/api\/user$/);
  await page.goto("/links");
  const heading = page.getByRole("heading", { level: 1, name: "Could not reach rdyrct" });
  await expect(heading).toBeVisible();
  await expect(page).toHaveURL(/\/links$/);

  // The admin guard does not read an outage as "not an admin".
  await page.goto("/admin");
  await expect(heading).toBeVisible();
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/links");
  await expect(heading).toBeVisible();
  await page.unroute(/\/api\/user$/);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Links" })).toBeVisible();
});

test("failed lists say so instead of showing an empty org", async ({ page }) => {
  await signUpAndVerify(page, `failed-lists-${Date.now()}@gmail.com`, password);

  const lists = [
    {
      path: "/links",
      url: /\/api\/orgs\/[^/]+\/links(\?|$)/,
      error: "Could not load your links",
      empty: page.getByRole("heading", { name: "No links yet" }),
    },
    {
      path: "/domains",
      url: /\/api\/orgs\/[^/]+\/domains$/,
      error: "Could not load your domains",
      // A free plan's empty list is the upsell.
      empty: page.getByText("Custom domains are available on Hobby and Pro."),
    },
    {
      path: "/members",
      url: /\/api\/orgs\/[^/]+\/members$/,
      error: "Could not load the members",
      empty: page.getByRole("table"),
    },
  ];

  for (const list of lists) {
    await fail(page, list.url);
    await page.goto(list.path);
    const alert = page.getByRole("alert").filter({ hasText: list.error });
    await expect(alert).toBeVisible();
    await expect(list.empty).toHaveCount(0);

    await page.unroute(list.url);
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toHaveCount(0);
    await expect(list.empty).toBeVisible();
  }
});
