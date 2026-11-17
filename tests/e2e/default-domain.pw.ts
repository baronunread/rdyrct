import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { addActiveCustomDomain, openNewLinkDialog } from "./orgs";

const password = "test-password-123";

test("new links start on the org's default domain, with the slug field unlocked (#69)", async ({
  page,
}) => {
  // Waiting for the domain to go active can take most of the default budget.
  test.slow();

  const email = `default-domain-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro");

  const hostname = await addActiveCustomDomain(page, `default-${Date.now()}.example.com`);

  const before = await openNewLinkDialog(page);
  await expect(before.getByPlaceholder("random")).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.goto("/domains");
  await page.getByRole("button", { name: `Make ${hostname} the default` }).click();
  await expect(page.getByText(`New links will use ${hostname}`)).toBeVisible();
  await expect(page.getByText("new links start on", { exact: false })).toContainText(hostname);
  await expect(page.getByRole("button", { name: `Make ${hostname} the default` })).toHaveCount(0);

  await page.goto("/organization");
  await expect(page.getByRole("button", { name: "Default domain" })).toContainText(hostname);

  const editor = await openNewLinkDialog(page);
  await expect(editor.getByLabel("Domain", { exact: true })).toHaveText(hostname);
  const slug = editor.getByPlaceholder("launch-2026");
  await expect(slug).toBeEnabled();

  await editor.getByPlaceholder("https://example.com/launch").fill("https://example.com/launch");
  await slug.fill("chosen-by-default");
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toContainText(
    `${hostname}/chosen-by-default`,
  );

  await page.goto("/domains");
  await page.getByRole("button", { name: `Actions for ${hostname}` }).click();
  await page.getByRole("menuitem", { name: `Stop defaulting to ${hostname}` }).click();
  await expect(page.getByText("New links will use the shared domain")).toBeVisible();

  const after = await openNewLinkDialog(page);
  await expect(after.getByPlaceholder("random")).toBeDisabled();
});
