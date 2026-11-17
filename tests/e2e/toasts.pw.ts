import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

test("a toast carries a tick for an outcome and a cross for a failure", async ({ page }) => {
  await signUpAndVerify(page, `toasts-${Date.now()}@gmail.com`, password);
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();

  const invitee = `toast-invitee-${Date.now()}@gmail.com`;
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder("Search links, pages and actions").fill(invitee);
  await page.getByRole("option", { name: `Invite ${invitee}` }).click();
  const sent = page.locator(".rdyrct-toast").filter({ hasText: `Invite sent to ${invitee}` });
  await expect(sent).toBeVisible();
  await expect(sent.locator('[data-toast-mark="ok"]')).toBeVisible();

  await page.route("**/api/orgs/*/invites", (route) =>
    route.fulfill({ status: 500, json: { error: "Could not send the invite" } }),
  );
  const again = `toast-refused-${Date.now()}@gmail.com`;
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder("Search links, pages and actions").fill(again);
  await page.getByRole("option", { name: `Invite ${again}` }).click();
  const failed = page.locator(".rdyrct-toast").filter({ hasNotText: "Invite sent" }).first();
  await expect(failed).toBeVisible();
  await expect(failed.locator('[data-toast-mark="error"]')).toBeVisible();
});
