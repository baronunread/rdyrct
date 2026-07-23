import { expect, test } from "@playwright/test";

test.describe("authentication forms", () => {
  test("keeps invalid login details in the browser instead of sending an auth request", async ({
    page,
  }) => {
    let authRequests = 0;
    await page.route("**/api/auth/**", async (route) => {
      authRequests++;
      await route.fulfill({ status: 500 });
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("person@localhost");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Password")).toHaveValue("password");
    expect(authRequests).toBe(0);
  });

  test("keeps a short sign-up password intact and does not submit it", async ({ page }) => {
    let authRequests = 0;
    await page.route("**/api/auth/**", async (route) => {
      authRequests++;
      await route.fulfill({ status: 500 });
    });

    await page.goto("/signup");
    await page.getByLabel("Email").fill("person@example.com");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel("Password")).toHaveValue("short");
    expect(authRequests).toBe(0);
  });
});
