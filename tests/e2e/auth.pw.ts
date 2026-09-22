import { expect, type Page, test } from "@playwright/test";
import { signUpAndVerify, latestOtp } from "./resend";
import { rawSql } from "./db";
import { signOut } from "./pages";

async function blockAuthRequests(page: Page) {
  const counter = { count: 0 };
  await page.route("**/api/auth/**", async (route) => {
    counter.count++;
    await route.fulfill({ status: 500 });
  });
  return counter;
}

const CONSENT_KEY = "rdyrct:consent:v2";

/** Records every PostHog capture this page attempts, decoded to plain JSON
 *  strings, then answers with a benign success instead of a real backend.
 *  Aborting instead of fulfilling looked equivalent but wasn't: an aborted
 *  /flags/ request left the SDK's own init/retry state unhealthy, and
 *  capture() never flushed at all as a result. */
async function trapCaptures(page: Page) {
  const captured: string[] = [];
  await page.route("**/*.i.posthog.com/**", async (route) => {
    const body = route.request().postData();
    const match = body?.match(/(?:^|&)data=([^&]+)/);
    if (match) {
      try {
        captured.push(Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8"));
      } catch {
        /* not base64: not worth failing the trap over */
      }
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return captured;
}

test.describe("authentication forms", () => {
  test("signs in with a verified account", async ({ page }) => {
    const email = `login-${Date.now()}@gmail.com`;
    const password = "test-password-123";

    await signUpAndVerify(page, email, password);

    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    // Signed in and already able to work: the account was given an
    // organization on its first session, so the switcher names one.
    await expect(page.getByTitle("Switch organization")).not.toHaveText("No organization");
  });

  // Regression for the case a mode-gated capture missed: someone signs up,
  // closes the tab before entering the code, and later comes back through
  // /login instead of /signup. trySignIn's EMAIL_NOT_VERIFIED branch sends
  // them to the same verify-otp screen, but under mode="login" this time.
  // That verification is still this account's one and only activation, so
  // it must still count as a signup (see auth.tsx's runVerify).
  test("resuming an abandoned signup through /login still counts as a signup", async ({ page }) => {
    const email = `resume-${Date.now()}@gmail.com`;
    const password = "test-password-123";

    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible({
      timeout: 30_000,
    });

    // Grant consent only once the account exists but before coming back to
    // verify: this is what makes the capture in step 2 observable at all.
    await page.evaluate((key) => localStorage.setItem(key, "accepted"), CONSENT_KEY);
    const captured = await trapCaptures(page);

    // Simulates actually closing the tab: sessionStorage's pendingVerify
    // survives a same-tab navigation, and readPending() would otherwise
    // resume straight to the code screen and skip the /login form (and the
    // EMAIL_NOT_VERIFIED branch this test means to exercise) entirely.
    await page.evaluate(() => sessionStorage.removeItem("rdyrct:pendingVerify"));
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible({
      timeout: 30_000,
    });

    const otp = await latestOtp(page, email);
    await page.locator("input").first().focus();
    await page.keyboard.insertText(otp);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    // posthog-js batches captures rather than sending each one immediately,
    // so the request can still be in flight a moment after the redirect.
    await expect
      .poll(() => captured.some((body) => body.includes("user_signed_up")), { timeout: 10_000 })
      .toBe(true);
  });

  test("keeps invalid login details in the browser instead of sending an auth request", async ({
    page,
  }) => {
    const authRequests = await blockAuthRequests(page);

    await page.goto("/login");
    await page.getByLabel("Email").fill("person@localhost");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Password")).toHaveValue("password");
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    expect(authRequests.count).toBe(0);
  });

  test("keeps a short sign-up password intact and does not submit it", async ({ page }) => {
    const authRequests = await blockAuthRequests(page);

    await page.goto("/signup");
    await page.getByLabel("Email").fill("person@example.com");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel("Password")).toHaveValue("short");
    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible();
    expect(authRequests.count).toBe(0);
  });

  test("rejects an invalid forgot-password email before accepting a valid one", async ({
    page,
  }) => {
    const authRequests = await blockAuthRequests(page);
    const email = `forgot-${Date.now()}@gmail.com`;

    await page.goto("/login");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();

    await page.getByLabel("Email").fill("person@localhost");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    expect(authRequests.count).toBe(0);

    await page.unroute("**/api/auth/**");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(email)).toBeVisible();
  });

  test("keeps an incomplete verification code in the browser instead of submitting it", async ({
    page,
  }) => {
    // Seeds the same sessionStorage key the app writes after a real sign-up
    // (see PENDING_KEY in auth.tsx) so the verify-otp view renders without
    // spending the shared sign-up/email rate-limit budget on a real request.
    const email = `otp-${Date.now()}@gmail.com`;
    await page.goto("/signup");
    await page.evaluate(
      ({ key, email, next }) => sessionStorage.setItem(key, JSON.stringify({ email, next })),
      { key: "rdyrct:pendingVerify", email, next: "/dashboard" },
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();

    const authRequests = await blockAuthRequests(page);
    await page.getByRole("button", { name: "Verify & continue" }).click();

    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await expect(page.getByText("Enter a 6-digit code")).toBeVisible();
    expect(authRequests.count).toBe(0);
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
    await expect(page.getByText("Email delivery unavailable")).toBeVisible();
  });

  test("signing up with a taken address looks like a fresh signup (#53)", async ({ page }) => {
    const victim = `taken-${Date.now()}@gmail.com`;
    // Seeded straight into D1 rather than signed up through the UI: a real
    // signup would spend this address's per-recipient email budget (#50),
    // and the probe below needs it. Nothing here signs in as them.
    await rawSql(
      page,
      "INSERT INTO user (id, name, email, email_verified, is_admin, banned, plan, created_at, updated_at) VALUES (?, 'Victim', ?, 1, 0, 0, 'free', 0, 0)",
      [`victim-${Date.now()}`, victim],
    );

    // Same address, a password of the prober's choosing: an outsider must
    // not be able to tell from the screen that this address is registered.
    await page.goto("/signup");
    await page.getByLabel("Email").fill(victim);
    await page.getByLabel("Password").fill("another-password-456");
    await page.getByRole("button", { name: "Sign up" }).click();

    // Exactly what a free address gives: on to the code screen, no hint.
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await expect(page.getByText("already has an account")).toBeHidden();

    // The owner is told, in the one place only they can read.
    await expect
      .poll(async () => {
        const response = await page.request.get("http://localhost:4000/emails", {
          headers: { authorization: "Bearer test_token_admin" },
        });
        if (!response.ok()) return "";
        const body = JSON.stringify(await response.json());
        return body.includes(victim) && body.includes("Someone tried to sign up") ? "notified" : "";
      })
      .toBe("notified");
  });
});
