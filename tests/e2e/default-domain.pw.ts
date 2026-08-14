import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { addActiveCustomDomain, openNewLinkDialog } from "./orgs";

const password = "test-password-123";

/**
 * An org that has bought and verified a domain should not have to re-pick it
 * on every link (#69).
 *
 * The slug field is the second half of the win and the part worth watching:
 * chosen slugs only exist on custom domains, so defaulting to one flips the
 * field from locked-random to editable without anybody touching the picker.
 */
test("new links start on the org's default domain, with the slug field unlocked (#69)", async ({
  page,
}) => {
  // Waiting for the domain to go active can take most of the default budget.
  test.slow();

  const email = `default-domain-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  // Custom domains are a paid feature.
  await setPlan(page, email, "pro");

  const hostname = await addActiveCustomDomain(page, `default-${Date.now()}.example.com`);

  // Before: a new link starts on the shared domain, so the slug is random.
  const before = await openNewLinkDialog(page);
  await expect(before.getByPlaceholder("random")).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.goto("/domains");
  await page.getByRole("button", { name: `Default new links to ${hostname}` }).click();
  await expect(page.getByText(`New links will use ${hostname}`)).toBeVisible();
  await expect(page.getByText("default", { exact: true })).toBeVisible();

  // After: the domain is preselected and the slug can be typed.
  const editor = await openNewLinkDialog(page);
  await expect(editor.getByLabel("Domain", { exact: true })).toHaveText(hostname);
  const slug = editor.getByPlaceholder("launch-2026");
  await expect(slug).toBeEnabled();

  await editor.getByPlaceholder("https://example.com/launch").fill("https://example.com/launch");
  await slug.fill("chosen-by-default");
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText(`${hostname}/chosen-by-default`)).toBeVisible();

  // Giving the default up sends new links back to the shared domain.
  await page.goto("/domains");
  await page.getByRole("button", { name: `Stop defaulting to ${hostname}` }).click();
  await expect(page.getByText("New links will use the shared domain")).toBeVisible();

  const after = await openNewLinkDialog(page);
  await expect(after.getByPlaceholder("random")).toBeDisabled();
});
