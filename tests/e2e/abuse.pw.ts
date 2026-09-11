import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

/**
 * The link shortener will not shorten another shortener's link (#224). The
 * account behind the 2026-09-10 incident pointed its links at bit.ly-style
 * hosts, which resolve fine and so scored "Clean". The worker tests cover the
 * host list and the route; this is the browser version: the create is refused
 * and the person is told why.
 */

const password = "test-password-123";

test("creating a link to another shortener is refused (#224)", async ({ page }) => {
  await signUpAndVerify(page, `abuse-${Date.now()}@gmail.com`, password);

  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await expect(destination).toBeVisible();
  await destination.fill("https://bit.ly/3xExamplE");
  await page.getByRole("button", { name: "Create link" }).click();

  // Errors are toasts, never inline field text.
  await expect(page.getByText(/another link shortener/i)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Link created" })).toHaveCount(0);
});
