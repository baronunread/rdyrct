import { expect, type Page } from "@playwright/test";

/** Depth-first search through an arbitrary JSON value (the emulator's
 * /emails response) for the email object that mentions `email`, then pulls
 * the 6-digit code out of its body.
 *
 * The plain-text part is read first, and only a line that is nothing but the
 * six digits counts. Scanning the whole serialized object for `\d{6}` used to
 * work, but the shared layout carries hex colours, and `#262336` is six
 * digits with word boundaries on both sides: it would be read as the code. */
export function otpForEmail(value: unknown, email: string): string {
  if (Array.isArray(value)) {
    return value.map((item) => otpForEmail(item, email)).find(Boolean) ?? "";
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const serialized = JSON.stringify(record);
  if (serialized.includes(email) && ("html" in record || "text" in record)) {
    const text = typeof record.text === "string" ? record.text : "";
    const onItsOwnLine = text.match(/^\s*(\d{6})\s*$/m)?.[1];
    if (onItsOwnLine) return onItsOwnLine;
    return serialized.match(/\b\d{6}\b/)?.[0] ?? "";
  }
  return (
    Object.values(record)
      .map((item) => otpForEmail(item, email))
      .find(Boolean) ?? ""
  );
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
}
