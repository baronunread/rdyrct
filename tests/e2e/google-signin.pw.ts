import { expect, test } from "@playwright/test";
import { signOut } from "./pages";

// Drives the Google button against the local emulate google service (started
// by the resend webServer, see playwright.config.ts). When Google isn't
// configured the button doesn't render, so we skip rather than fail.
test.describe("Google sign-in", () => {
  test("Continue with Google starts an OAuth session", async ({ page }) => {
    const cfg = await (await page.request.get("/api/config")).json();
    if (!cfg.googleEnabled) test.skip(true, "Google sign-in not configured");

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

  test("a full Google round trip signs in, and /login then offers 'continue as'", async ({
    page,
  }) => {
    const cfg = await (await page.request.get("/api/config")).json();
    if (!cfg.googleEnabled) test.skip(true, "Google sign-in not configured");

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

  test("shows the Google button on signup too", async ({ page }) => {
    const cfg = await (await page.request.get("/api/config")).json();
    if (!cfg.googleEnabled) test.skip(true, "Google sign-in not configured");

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });
});
