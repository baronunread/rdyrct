import { expect, test, type Page } from "@playwright/test";
import { makePlatformAdmin, queryRows } from "./db";
import { latestMailTextTo, signUpAndVerify, submitSignup, verifySignup } from "./resend";

const PASSWORD = "test-password-123";
const NEWS_BOX = "Send me product news and tips. Unsubscribe any time.";

interface Consent {
  at: string | null;
  source: string | null;
  asked: string | null;
}

async function consentOf(page: Page, email: string): Promise<Consent> {
  const [row] = await queryRows<Consent>(
    page,
    `SELECT marketing_opt_in_at AS at, marketing_opt_in_source AS source,
            marketing_asked_at AS asked FROM user WHERE email = ?`,
    [email],
  );
  return row;
}

/** An existing account the one-time dialog has not asked yet. Test accounts
 * are made already asked (dev-scenarios.ts), so this one opts out of that. */
async function unaskedAccount(page: Page, email: string) {
  const res = await page.request.post("/__dev/test-account", {
    data: { email, password: PASSWORD, asked: false },
  });
  expect(res.status(), await res.text()).toBe(201);
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Product news by email?" });

test.describe("product news opt-in", () => {
  test("the sign-up box starts unticked and a ticked one opts the account in", async ({ page }) => {
    await page.goto("/signup");
    const box = page.getByLabel(NEWS_BOX);
    await expect(box).not.toBeChecked();
    await box.check();

    const email = `news-yes-${Date.now()}@gmail.com`;
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 30_000,
    });
    await verifySignup(page, email);

    // Answered at sign-up, so the dialog never asks.
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await consentOf(page, email)).source, { timeout: 15_000 })
      .toBe("signup");
    const row = await consentOf(page, email);
    expect(row.at).not.toBeNull();
    expect(row.asked).not.toBeNull();
  });

  test("an unticked sign-up records a no and is not asked again", async ({ page }) => {
    const email = `news-no-${Date.now()}@gmail.com`;
    await submitSignup(page, email, PASSWORD);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 30_000,
    });
    await verifySignup(page, email);
    await expect(dialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await consentOf(page, email)).asked, { timeout: 15_000 })
      .not.toBeNull();
    const row = await consentOf(page, email);
    expect(row.at).toBeNull();
    expect(row.source).toBe("signup");
  });

  test("the Google button carries the ticked box through the redirect", async ({ page }) => {
    const cfg = await (await page.request.get("/api/config")).json();
    test.skip(!cfg.googleEnabled, "Google sign-in not configured");
    await page.route("**/api/auth/sign-in/social**", (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
    await page.goto("/signup");
    await page.getByLabel(NEWS_BOX).check();
    const button = page.getByRole("button", { name: /Continue with Google/i });
    await expect(button).toBeEnabled();
    await button.click();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("rdyrct:marketingChoice")))
      .toContain('"optIn":true');
  });

  test("an account that was never asked sees the dialog once, and a dismissal ends it", async ({
    page,
  }) => {
    const email = `news-dismiss-${Date.now()}@example.com`;
    await unaskedAccount(page, email);
    await page.goto("/dashboard");
    await expect(dialog(page)).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await consentOf(page, email)).asked, { timeout: 15_000 })
      .not.toBeNull();
    const row = await consentOf(page, email);
    expect(row.at).toBeNull();
    expect(row.source).toBe("prompt");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("saying yes in the dialog opts in, and Settings turns it off and on", async ({ page }) => {
    const email = `news-settings-${Date.now()}@example.com`;
    await unaskedAccount(page, email);
    await page.goto("/dashboard");
    await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
    await dialog(page).getByRole("button", { name: "Yes, email me" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await consentOf(page, email)).source, { timeout: 15_000 })
      .toBe("prompt");
    expect((await consentOf(page, email)).at).not.toBeNull();

    await page.goto("/settings");
    const toggle = page.getByRole("switch", { name: "Product news" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText("Product news is off")).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect.poll(async () => (await consentOf(page, email)).at).toBeNull();
    expect((await consentOf(page, email)).source).toBe("settings");

    await toggle.click();
    await expect(page.getByText("Product news is on")).toBeVisible();
    await expect.poll(async () => (await consentOf(page, email)).at).not.toBeNull();
  });

  test("an admin test send carries a working unsubscribe link", async ({ page }) => {
    const email = `news-admin-${Date.now()}@example.com`;
    await signUpAndVerify(page, email, PASSWORD);
    await makePlatformAdmin(page, email);

    await page.goto("/settings");
    await page.getByRole("switch", { name: "Product news" }).click();
    await expect(page.getByText("Product news is on")).toBeVisible();

    await page.goto("/admin/newsletter");
    await expect(page.getByText(/opted in/).first()).toBeVisible();
    await page.getByRole("button", { name: "Send to" }).click();
    // A form error marks its fields; nothing is sent.
    await expect(page.getByText("Add a subject")).toBeVisible();
    await expect(page.getByText("Write the email")).toBeVisible();

    await page.getByLabel("Subject").fill("Hello from the test");
    await page.getByLabel("Message").fill("First paragraph.\n\nSecond paragraph.");
    await page.getByRole("button", { name: "Send test to me" }).click();
    await expect(page.getByText("Test sent to you")).toBeVisible();

    let link = "";
    await expect
      .poll(async () => {
        const text = await latestMailTextTo(page, email);
        link = text?.match(/Unsubscribe: (\S+)/)?.[1] ?? "";
        return link;
      })
      .toContain("/unsubscribe?t=");

    // The link works with no session at all.
    await page.context().clearCookies();
    await page.goto(link);
    await expect(
      page.getByRole("heading", { name: "Unsubscribe from product news?" }),
    ).toBeVisible();
    expect((await consentOf(page, email)).at).not.toBeNull();
    await page.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(page.getByRole("heading", { name: "You are unsubscribed" })).toBeVisible();
    expect((await consentOf(page, email)).at).toBeNull();
  });

  test("an unsubscribe link with a bad token says so", async ({ page }) => {
    await page.goto("/unsubscribe?t=nope.nope");
    await expect(page.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
  });
});
