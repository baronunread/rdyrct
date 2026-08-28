import { expect, test, type Page } from "@playwright/test";
import { signOut } from "./pages";
import { signUpAndVerify } from "./resend";

// Drives the Google button against the local emulate google service (started
// by the resend webServer, see playwright.config.ts). When Google isn't
// configured the button doesn't render, so we skip rather than fail.
//
// The emulator always signs in as testuser@gmail.com, so the tests that use
// the real OAuth round trip share that one identity and run in order: the
// linking test claims the password account first, the rest sign into it.
async function requireGoogle(page: Page) {
  const cfg = await (await page.request.get("/api/config")).json();
  if (!cfg.googleEnabled) test.skip(true, "Google sign-in not configured");
}

test.describe("Google sign-in", () => {
  test("Continue with Google starts an OAuth session", async ({ page }) => {
    await requireGoogle(page);

    let socialStarted = false;
    await page.route("**/api/auth/sign-in/social**", async (route) => {
      socialStarted = true;
      // Stop the navigation at the worker's redirect so the test ends here.
      await route.fulfill({ status: 200, body: "" });
    });

    await page.goto("/login");
    const button = page.getByRole("button", { name: /Continue with Google/i });
    await expect(button).toBeVisible();

    await button.click();
    await expect.poll(() => socialStarted).toBe(true);
  });

  test("shows the Google button on signup too", async ({ page }) => {
    await requireGoogle(page);

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });

  test("linking Google to an existing account pulls in the Google profile", async ({ page }) => {
    await requireGoogle(page);

    // A password account under the address the emulator signs in as.
    await signUpAndVerify(page, "testuser@gmail.com", "test-password-123");
    const menu = page.getByRole("button", { name: "Account menu" });
    await expect(menu).toContainText("testuser");

    await signOut(page);
    await page.goto("/login");
    await page.getByRole("button", { name: /Continue with Google/i }).click();
    await page.getByRole("button", { name: /testuser@gmail\.com/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // updateUserInfoOnLink copied the Google display name onto the account.
    await expect(menu).toContainText("Test User");
  });

  test("a full Google round trip signs in, and /login then offers 'continue as'", async ({
    page,
  }) => {
    await requireGoogle(page);

    await page.goto("/login");
    await page.getByRole("button", { name: /Continue with Google/i }).click();

    // The emulate consent screen: pick the seeded test account.
    await page.getByRole("button", { name: /testuser@gmail\.com/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Sign out, and the login page now leads with a one-click row for that
    // account instead of the plain button.
    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);
    const resume = page.getByRole("button", { name: "Continue as testuser@gmail.com" });
    await expect(resume).toBeVisible();
    await expect(resume).toContainText("Last used");
  });
});
