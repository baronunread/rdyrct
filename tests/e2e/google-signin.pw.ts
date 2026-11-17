import { expect, test, type Page } from "@playwright/test";
import { signOut } from "./pages";
import { signUpThroughForm, skipSetup } from "./resend";

async function requireGoogle(page: Page) {
  const cfg = await (await page.request.get("/api/config")).json();
  if (!cfg.googleEnabled) test.skip(true, "Google sign-in not configured");
}

async function signInWithGoogle(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Continue with Google/i }).click();
  await page.getByRole("button", { name: /testuser@gmail\.com/ }).click();
  const flow = page.getByRole("heading", { name: "What should we call your organization?" });
  const app = page.getByRole("link", { name: "Dashboard" });
  await expect(flow.or(app).first()).toBeVisible({ timeout: 15_000 });
  if (await flow.isVisible()) await skipSetup(page);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("Google sign-in", () => {
  // The emulator is one shared identity and these tests build on each other:
  // the linking test claims the password account, the rest sign into it. The
  // suite's fullyParallel would race them, so pin the order.
  test.describe.configure({ mode: "serial" });

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
    await expect(button).toBeEnabled();

    await button.click();
    await expect.poll(() => socialStarted).toBe(true);
  });

  test("shows the Google button on signup too", async ({ page }) => {
    await requireGoogle(page);

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });

  test("the Google button is disabled where Google is not configured", async ({ page }) => {
    await page.route("**/api/config", async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      await route.fulfill({ response, json: { ...config, googleEnabled: false } });
    });

    for (const path of ["/login", "/signup"]) {
      // Disabled is also the state before /config arrives, so wait for it.
      const answered = page.waitForResponse("**/api/config");
      await page.goto(path);
      await answered;
      const button = page.getByRole("button", { name: /Continue with Google/i });
      await expect(button, path).toBeDisabled();
      await expect(button, path).toHaveAccessibleDescription(
        "Google sign-in is not available here",
      );
    }
  });

  test("linking Google to an existing account keeps the local name", async ({ page }) => {
    await requireGoogle(page);

    await signUpThroughForm(page, "testuser@gmail.com", "test-password-123");
    const menu = page.getByRole("button", { name: "Account menu" });
    await expect(menu).toContainText("testuser");

    await signOut(page);
    await signInWithGoogle(page);

    await expect(menu).toContainText("testuser");
    await expect(menu).not.toContainText("Test User");
  });

  test("a full Google round trip signs in, and /login then offers 'continue as'", async ({
    page,
  }) => {
    await requireGoogle(page);
    await signInWithGoogle(page);

    await page.goto("/settings");
    await expect(page.getByTestId("google-account")).toHaveText("testuser@gmail.com");

    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);
    const resume = page.getByRole("button", { name: "Continue as testuser@gmail.com" });
    await expect(resume).toBeVisible();
    await expect(resume).toContainText("Last used");
  });
});
