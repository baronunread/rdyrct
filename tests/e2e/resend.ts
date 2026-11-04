import { expect, type Page } from "@playwright/test";
import type { JsonValue } from "../../src/shared/types";

function isRecord(value: JsonValue): value is { [k: string]: JsonValue } {
  return value instanceof Object && !Array.isArray(value);
}

/** The 6-digit code out of one email's body. The plain-text part is read
 * first (a line that is nothing but six digits, then any `\d{6}` in it),
 * and the html last: the shared layout inlines hex colours, and `#262336`
 * is a bare `\d{6}`, so it must never be reached while the text carries a
 * real code. */
function codeFromBody(email: { [k: string]: JsonValue }): string {
  const text = String(email.text ?? "");
  const html = String(email.html ?? "");
  return (
    text.match(/^\s*(\d{6})\s*$/m)?.[1] ??
    text.match(/\b\d{6}\b/)?.[0] ??
    html.match(/\b\d{6}\b/)?.[0] ??
    ""
  );
}

/** The emulator's `/emails` payload as a flat array: the raw `{ data: [...] }`
 * list, a bare array, or nothing. */
function inboxList(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.data)) return value.data;
  return [];
}

/** Whether an inbox entry was sent to `email` (its `to` is one address or an
 * array of them). */
function addressedTo(item: JsonValue, email: string): boolean {
  if (!isRecord(item)) return false;
  const to = Array.isArray(item.to) ? item.to : [item.to];
  return to.some((addr) => String(addr).includes(email));
}

/** The verification code from the *newest* email the emulator holds for
 * `email`. The list is in send order, so taking the last code means a retry
 * that re-sends to the same address, or a busy shared inbox, can never hand
 * back a stale one. Returns "" when there is no code yet. */
export function otpForEmail(value: JsonValue, email: string): string {
  const codes = inboxList(value)
    .filter((item) => addressedTo(item, email))
    .map((item) => (isRecord(item) ? codeFromBody(item) : ""))
    .filter(Boolean);
  return codes[codes.length - 1] ?? "";
}

/** The subjects of every email the emulator holds for `email`, oldest first. */
export async function subjectsSentTo(page: Page, email: string): Promise<string[]> {
  const response = await page.request.get("http://localhost:4000/emails", {
    headers: { authorization: "Bearer test_token_admin" },
  });
  if (!response.ok()) return [];
  return inboxList(await response.json())
    .filter((item) => addressedTo(item, email))
    .map((item) => (isRecord(item) ? String(item.subject ?? "") : ""));
}

async function latestOtp(page: Page, email: string) {
  let otp = "";
  await expect
    .poll(async () => {
      const response = await page.request.get("http://localhost:4000/emails", {
        headers: { authorization: "Bearer test_token_admin" },
      });
      if (!response.ok()) return "";
      otp = otpForEmail(await response.json(), email);
      return otp;
    })
    .not.toBe("");

  return otp;
}

/** Fills in and submits the sign-up form, and stops there. */
export async function submitSignup(page: Page, email: string, password: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
}

/** Types the emailed code into the code screen. */
export async function enterCode(page: Page, email: string) {
  const otp = await latestOtp(page, email);
  await page.locator("input").first().focus();
  await page.keyboard.insertText(otp);
}

export async function verifySignup(page: Page, email: string) {
  await enterCode(page, email);
  await skipSetup(page);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

/**
 * Past the new organization's setup flow (/welcome) by its skip buttons,
 * for the specs that sign up through the form but are about something else.
 * The flow itself is tests/e2e/onboarding.pw.ts.
 */
export async function skipSetup(page: Page) {
  await expect(
    page.getByRole("heading", { name: "What should we call your organization?" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  // An account not yet asked about email gets one more step; one that
  // answered before (a Google sign-in to an existing address) goes straight in.
  const emailStep = page.getByRole("heading", { name: "Hear from rdyrct by email?" });
  const app = page.getByRole("heading", { name: "Dashboard", level: 1 });
  await expect(emailStep.or(app)).toBeVisible({ timeout: 30_000 });
  if (await emailStep.isVisible()) {
    await expect(page.getByRole("img", { name: "Step 5 of 5" })).toBeVisible();
    await page.getByRole("button", { name: "Skip" }).click();
  }
}

/**
 * A verified, signed-in account on the dashboard, in one request instead of
 * the form (src/worker/dev-scenarios.ts, POST /__dev/test-account). For every
 * spec that needs somebody to be but is not about signing up: the form costs
 * 6 to 7 seconds a test and most specs paid it only to get here.
 *
 * Specs that are about sign-up itself use `signUpThroughForm`.
 */
export async function signUpAndVerify(page: Page, email: string, password: string) {
  const res = await page.request.post("/__dev/test-account", { data: { email, password } });
  expect(res.status(), await res.text()).toBe(201);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
}

/** The whole sign-up as a person goes through it: form, Turnstile, the
 * emailed code. For the specs that are about that flow. */
export async function signUpThroughForm(page: Page, email: string, password: string) {
  await submitSignup(page, email, password);

  // Not the default 5s: a sign-up here is a Turnstile challenge, an
  // account write and a mail send, and with the suite running in parallel
  // that round trip regularly outlasts five seconds. Every caller of this
  // helper was failing here for that reason and no other.
  const codeScreen = page.getByRole("heading", { name: "Check your email" });
  await expect(codeScreen).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(codeScreen).toBeVisible({ timeout: 30_000 });
  await verifySignup(page, email);

  // The URL changes first and the page arrives after it. A fresh account has
  // nothing cached, so the dashboard under the chrome still owes /user, the
  // org and the stats before it renders anything to act on. A new account
  // gets the first-run create field ("Shorten your first link"); one that
  // claimed an anonymous link on the way in (anon-shortener.pw.ts) gets the
  // dashboard proper, which has a New link button and no field. Either one
  // means the page has loaded.
  //
  // Waiting here rather than in each caller is the point: the next assertion
  // in a test carries Playwright's default 5s, which is not a budget for
  // three round trips on a loaded runner. Callers were failing on their own
  // first line for the same reason sign-up above needed 30s.
  await expect(
    page
      .getByPlaceholder("https://example.com/launch")
      .or(page.getByRole("heading", { name: "Dashboard", level: 1 }))
      .first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** The text of the newest email the emulator holds for `email`, or null.
 * For a spec that reads a link out of a message (an unsubscribe link). */
export async function latestMailTextTo(page: Page, email: string): Promise<string | null> {
  const response = await page.request.get("http://localhost:4000/emails", {
    headers: { authorization: "Bearer test_token_admin" },
  });
  if (!response.ok()) return null;
  const mine = inboxList(await response.json()).filter((item) => addressedTo(item, email));
  const newest = mine.at(-1);
  return newest && isRecord(newest) ? String(newest.text ?? "") : null;
}
