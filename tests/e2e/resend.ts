import { expect, type Page } from "@playwright/test";

/** Depth-first search through an arbitrary JSON value (the emulator's
 * /emails response) for the email object that mentions `email`, then pulls
 * the 6-digit code out of its body. */
export function otpForEmail(value: unknown, email: string): string {
  if (Array.isArray(value)) {
    return value.map((item) => otpForEmail(item, email)).find(Boolean) ?? "";
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const serialized = JSON.stringify(record);
  if (serialized.includes(email) && ("html" in record || "text" in record)) {
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

  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  const otp = await latestOtp(page, email);
  await page.locator("input").first().focus();
  await page.keyboard.insertText(otp);
  await expect(page).toHaveURL(/\/dashboard$/);
}
