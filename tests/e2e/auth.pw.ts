import { expect, type Page, test } from "@playwright/test";
import { signUpThroughForm, subjectsSentTo, verifySignup, submitSignup } from "./resend";
import { rawSql } from "./db";
import { signOut } from "./pages";
import { currentOrgName } from "./orgs";

async function blockAuthRequests(page: Page) {
  const counter = { count: 0 };
  await page.route("**/api/auth/**", async (route) => {
    counter.count++;
    await route.fulfill({ status: 500 });
  });
  return counter;
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a new account gets one welcome email once its address is verified", async ({ page }) => {
  const email = `welcome-${Date.now()}@gmail.com`;
  await signUpThroughForm(page, email, "test-password-123");

  await expect
    .poll(async () => (await subjectsSentTo(page, email)).filter((s) => s === "Welcome to rdyrct"))
    .toHaveLength(1);
});

test("a sign-up sent before /api/config answers still carries a Turnstile token", async ({
  page,
}) => {
  // The site key arrives with /api/config. A form submitted before that used
  // to go out with no token, be refused, retry with no token again, and fail.
  await page.route("**/api/config", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await route.continue();
  });
  const email = `slow-config-${Date.now()}@gmail.com`;
  await submitSignup(page, email, "test-password-123");

  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible({
    timeout: 40_000,
  });
});

test.describe("authentication forms", () => {
  for (const token of [null, "fresh-signup-session"]) {
    test(`no-mail signup counts completion only with a fresh session (${token ? "new" : "duplicate"})`, async ({
      page,
    }) => {
      await page.route("**/api/config", async (route) => {
        const config = await (await route.fetch()).json();
        await route.fulfill({ json: { ...config, emailEnabled: false } });
      });
      await page.route("**/api/auth/sign-up/email", (route) =>
        route.fulfill({ json: { token, user: { id: "signup-response", emailVerified: !!token } } }),
      );
      await page.route("**/api/auth/sign-in/email", (route) =>
        route.fulfill({
          status: 401,
          json: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
        }),
      );
      await page.goto("/signup");
      const events: string[] = [];
      await page.exposeFunction("recordSignupEvent", (event: string) => events.push(event));
      await page.evaluate(async () => {
        const modulePath = "/src/app/lib/posthog.ts";
        const { default: posthog } = await import(modulePath);
        posthog.capture = (event) => window.recordSignupEvent(event);
      });
      await page.getByLabel("Email").fill("duplicate-signup@example.com");
      await page.getByLabel("Password").fill("test-password-123");
      const signIn = page.waitForResponse("**/api/auth/sign-in/email");
      await page.getByRole("button", { name: "Sign up", exact: true }).click();
      await signIn;
      expect(events.filter((event) => event === "user_signed_up")).toHaveLength(token ? 1 : 0);
    });
  }

  test("signs in with a verified account", async ({ page }) => {
    const email = `login-${Date.now()}@gmail.com`;
    const password = "test-password-123";

    await signUpThroughForm(page, email, password);

    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);

    await submitLogin(page, email, password);

    await expect(page).toHaveURL(/\/dashboard$/);
    // Signed in and already able to work: the account was given an
    // organization on its first session, so the switcher names one.
    await expect(currentOrgName(page)).not.toHaveText("No organization");
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

    await submitSignup(page, email, password);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible({
      timeout: 30_000,
    });

    // Simulates actually closing the tab: sessionStorage's pendingVerify
    // survives a same-tab navigation, and readPending() would otherwise
    // resume straight to the code screen and skip the /login form (and the
    // EMAIL_NOT_VERIFIED branch this test means to exercise) entirely.
    await page.evaluate(() => sessionStorage.removeItem("rdyrct:pendingVerify"));
    await page.goto("/login");
    await submitLogin(page, email, password);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible({
      timeout: 30_000,
    });

    const completed: string[] = [];
    await page.exposeFunction("recordSignupMethod", (method: string) => completed.push(method));
    await page.evaluate(async () => {
      const modulePath = "/src/app/lib/posthog.ts";
      const { default: posthog } = await import(modulePath);
      posthog.capture = (event, properties) => {
        if (event === "user_signed_up") window.recordSignupMethod(properties?.method);
      };
    });
    // The functional regression this covers: verifying through /login used
    // to run the exact same code path as verifying through /signup (see
    // runVerify in auth.tsx), just under mode="login". Reaching /dashboard
    // here proves the resumed signup completes. Observe the capture call
    // directly so the assertion does not depend on the SDK's transport.
    await verifySignup(page, email);
    expect(completed).toEqual(["email"]);
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
