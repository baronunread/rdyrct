import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { openNewLinkForm, signUpProWithDomain } from "./orgs";

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

  const form = await openNewLinkForm(page);
  await form
    .getByRole("textbox", { name: "Destination", exact: true })
    .fill("https://bit.ly/3xExamplE");
  await form.getByRole("button", { name: "Create link" }).click();

  // The refusal says why, and no link is made.
  await expect(page.getByText(/another link shortener/i)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Link created" })).toHaveCount(0);
});

test("a custom domain's root redirect gets the same refusal, on its field (#488)", async ({
  page,
}) => {
  // Waiting for the domain to go active can take most of the default budget.
  test.slow();
  const email = `abuse-root-${Date.now()}@gmail.com`;
  const hostname = await signUpProWithDomain(page, email, password);

  const row = page.locator(`[data-domain="${hostname}"]`);
  await row.getByRole("button", { name: /Edit the root redirect/ }).click();
  const field = row.getByRole("textbox", { name: `Where ${hostname} with no slug goes` });
  await field.fill("https://bit.ly/3xExamplE");
  await field.press("Enter");

  // The field is marked, with the reason beside it, and no toast says it
  // instead. Nothing is saved.
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(row.getByRole("alert")).toHaveText("Another shortener");
  await expect(page.getByText(/with no slug now opens/)).toHaveCount(0);

  // Typing clears the mark, and an ordinary address saves.
  await field.fill("https://example.com/home");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await field.press("Enter");
  await expect(page.getByText(`${hostname} with no slug now opens example.com/home`)).toBeVisible();
});
