import { expect, type Page } from "@playwright/test";
import * as v from "valibot";
import type { JsonValue } from "../../src/shared/types";

function asText(value: JsonValue | undefined): string {
  const text = v.safeParse(v.string(), value);
  return text.success ? text.output : "";
}

function isRecord(value: JsonValue): value is { [k: string]: JsonValue } {
  return value instanceof Object && !Array.isArray(value);
}

/** Reads the plain text first: the html layout inlines hex colours, and `#262336` is a bare `\d{6}`. */
function codeFromBody(email: { [k: string]: JsonValue }): string {
  const text = asText(email.text);
  const html = asText(email.html);
  return (
    text.match(/^\s*(\d{6})\s*$/m)?.[1] ??
    text.match(/\b\d{6}\b/)?.[0] ??
    html.match(/\b\d{6}\b/)?.[0] ??
    ""
  );
}

function inboxList(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.data)) return value.data;
  return [];
}

function addressedTo(item: JsonValue, email: string): boolean {
  if (!isRecord(item)) return false;
  const to = Array.isArray(item.to) ? item.to : [item.to];
  return to.some((addr) => asText(addr).includes(email));
}

/** The last code in send order, so a retry or a busy shared inbox never returns a stale one. */
export function otpForEmail(value: JsonValue, email: string): string {
  const codes = inboxList(value)
    .filter((item) => addressedTo(item, email))
    .map((item) => (isRecord(item) ? codeFromBody(item) : ""))
    .filter(Boolean);
  return codes[codes.length - 1] ?? "";
}

export async function subjectsSentTo(page: Page, email: string): Promise<string[]> {
  const response = await page.request.get("http://localhost:4000/emails", {
    headers: { authorization: "Bearer test_token_admin" },
  });
  if (!response.ok()) return [];
  return inboxList(await response.json())
    .filter((item) => addressedTo(item, email))
    .map((item) => (isRecord(item) ? asText(item.subject) : ""));
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

export async function submitSignup(page: Page, email: string, password: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
}

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
  const emailStep = page.getByRole("heading", { name: "What should we email you about?" });
  const app = page.getByRole("heading", { name: "Dashboard", level: 1 });
  await expect(emailStep.or(app)).toBeVisible({ timeout: 30_000 });
  if (await emailStep.isVisible()) {
    await expect(page.getByRole("img", { name: "Step 5 of 5" })).toBeVisible();
    await page.getByRole("button", { name: "Skip" }).click();
  }
}

export async function signUpAndVerify(page: Page, email: string, password: string) {
  const res = await page.request.post("/__dev/test-account", { data: { email, password } });
  expect(res.status(), await res.text()).toBe(201);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
}

export async function signUpThroughForm(page: Page, email: string, password: string) {
  await submitSignup(page, email, password);

  // Not the default 5s: Turnstile, an account write and a mail send outlast it when the suite runs in parallel.
  const codeScreen = page.getByRole("heading", { name: "Check your email" });
  await expect(codeScreen).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(codeScreen).toBeVisible({ timeout: 30_000 });
  await verifySignup(page, email);

  // Wait here, not in callers: the next assertion's default 5s is no budget for three round trips on a loaded runner.
  await expect(
    page
      .getByPlaceholder("https://example.com/launch")
      .or(page.getByRole("heading", { name: "Dashboard", level: 1 }))
      .first(),
  ).toBeVisible({ timeout: 30_000 });
}

export async function latestMailTextTo(page: Page, email: string): Promise<string | null> {
  const response = await page.request.get("http://localhost:4000/emails", {
    headers: { authorization: "Bearer test_token_admin" },
  });
  if (!response.ok()) return null;
  const mine = inboxList(await response.json()).filter((item) => addressedTo(item, email));
  const newest = mine.at(-1);
  return newest && isRecord(newest) ? asText(newest.text) : null;
}
