import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

test.describe("authentication forms", () => {
  test("signs in with a verified account", async ({ page }) => {
    const email = `login-${Date.now()}@gmail.com`;
    const password = "test-password-123";

    await signUpAndVerify(page, email, password);

    await page.getByLabel("Sign out").click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("No organization", { exact: true })).toBeVisible();
  });

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
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveClass(/animate-shake/);
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Sign up" })).toHaveClass(/animate-shake/);
    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible();
    expect(authRequests).toBe(0);
  });

  test("stays on sign-up when verification-code delivery fails", async ({ page }) => {
    const email = `delivery-failure-${Date.now()}@gmail.com`;
    await page.route("**/api/auth/email-otp/send-verification-otp", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "EMAIL_DELIVERY_FAILED",
          message: "Email delivery unavailable",
        }),
      });
    });

    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("test-password-123");
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign up" })).toHaveClass(/animate-shake/);
    await expect(page.getByText("Email delivery unavailable")).toBeVisible();
  });
});
