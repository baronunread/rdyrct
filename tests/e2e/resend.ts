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

export async function latestOtp(page: Page, email: string) {
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

export async function signUpAndVerify(page: Page, email: string, password: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();

  // Not the default 5s: a sign-up here is a Cap proof-of-work solve, an
  // account write and a mail send, and with the suite running in parallel
  // that round trip regularly outlasts five seconds. Every caller of this
  // helper was failing here for that reason and no other.
  const codeScreen = page.getByRole("heading", { name: "Enter your code" });
  await expect(codeScreen).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(codeScreen).toBeVisible({ timeout: 30_000 });
  const otp = await latestOtp(page, email);
  await page.locator("input").first().focus();
  await page.keyboard.insertText(otp);
  await expect(page).toHaveURL(/\/dashboard$/);

  // The URL changes first and the page arrives after it. A fresh account has
  // nothing cached, so the dashboard under the chrome still owes /user, the
  // org and the stats before it renders anything to act on. The create field
  // is the signal because it is the one thing the loaded dashboard always
  // draws: the heading is not, it reads "Shorten your first link" for a new
  // account and "Dashboard" for one that claimed an anonymous link on the way
  // in (anon-shortener.pw.ts).
  //
  // Waiting here rather than in each caller is the point: the next assertion
  // in a test carries Playwright's default 5s, which is not a budget for
  // three round trips on a loaded runner. Callers were failing on their own
  // first line for the same reason sign-up above needed 30s.
  await expect(page.getByPlaceholder("https://example.com/launch").first()).toBeVisible({
    timeout: 30_000,
  });
}
