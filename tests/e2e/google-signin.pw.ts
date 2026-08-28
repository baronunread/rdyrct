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

/** From /login through the emulate consent screen to a signed-in dashboard. */
async function signInWithGoogle(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Continue with Google/i }).click();
  await page.getByRole("button", { name: /testuser@gmail\.com/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
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

  test("linking Google to an existing account keeps the local name", async ({ page }) => {
    await requireGoogle(page);

    // A password account under the address the emulator signs in as.
    await signUpAndVerify(page, "testuser@gmail.com", "test-password-123");
    const menu = page.getByRole("button", { name: "Account menu" });
    await expect(menu).toContainText("testuser");

    await signOut(page);
    await signInWithGoogle(page);

    // The link must not overwrite the name with the Google profile's.
    await expect(menu).toContainText("testuser");
    await expect(menu).not.toContainText("Test User");
  });

  test("a full Google round trip signs in, and /login then offers 'continue as'", async ({
    page,
  }) => {
    await requireGoogle(page);
    await signInWithGoogle(page);

    // Sign out, and the login page now leads with a one-click row for that
    // account instead of the plain button.
    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);
    const resume = page.getByRole("button", { name: "Continue as testuser@gmail.com" });
    await expect(resume).toBeVisible();
    await expect(resume).toContainText("Last used");
  });
});
