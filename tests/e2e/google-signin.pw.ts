import { expect, test } from "@playwright/test";

// Drives the Google button. The button only renders when Google is configured
// (GOOGLE_CLIENT_ID/SECRET in .dev.vars), so when it isn't we skip rather than
// fail: the gating itself is covered by /api/config.
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

    // The method is remembered: a return visit flags the Google button.
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: /Continue with Google/i }).getByText("Last used"),
    ).toBeVisible();
  });

  test("shows the Google button on signup too", async ({ page }) => {
    const cfg = await (await page.request.get("/api/config")).json();
    if (!cfg.googleEnabled) test.skip(true, "Google sign-in not configured");

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });
});
