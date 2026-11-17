import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, rawSql } from "./db";
import { openNewLinkForm, signUpProWithDomain } from "./orgs";

// #224: the account behind the 2026-09-10 incident used bit.ly-style hosts, which
// resolve fine and scored "Clean", so only the host list can refuse them.

const password = "test-password-123";

test("creating a link to another shortener is refused (#224)", async ({ page }) => {
  await signUpAndVerify(page, `abuse-${Date.now()}@gmail.com`, password);

  const form = await openNewLinkForm(page);
  await form
    .getByRole("textbox", { name: "Destination", exact: true })
    .fill("https://bit.ly/3xExamplE");
  await form.getByRole("button", { name: "Create link" }).click();

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

  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(row.getByRole("alert")).toHaveText("Another shortener");
  await expect(page.getByText(/with no slug now opens/)).toHaveCount(0);

  // The domain's own host would send every unknown slug back to itself.
  await field.fill(`https://${hostname}/home`);
  await field.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(row.getByRole("alert")).toHaveText("This domain itself");
  await expect(page.getByText(/with no slug now opens/)).toHaveCount(0);

  await field.fill("https://example.com/home");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await field.press("Enter");
  await expect(page.getByText(`${hostname} with no slug now opens example.com/home`)).toBeVisible();
});

test("a report about an anonymous link reaches the admin as one (#488)", async ({ page }) => {
  const email = `abuse-anon-report-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await makePlatformAdmin(page, email);
  // Inserted directly: the shortener's own spec covers making one through Turnstile.
  const slug = `an${Date.now().toString(36)}`;
  await rawSql(
    page,
    `insert into anon_links (id, slug, destination, claim_token, created_at, expires_at)
     values (?, ?, 'https://example.com/anon', ?, ?, ?)`,
    [`anon-${slug}`, slug, `tok-${slug}`, Date.now(), Date.now() + 24 * 60 * 60 * 1000],
  );

  await page.goto(`/report?link=${slug}`);
  await page.getByLabel("Details (optional)").fill("fake bank login");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thanks. We will look at it.")).toBeVisible({ timeout: 15_000 });

  await page.goto("/admin/links");
  await page
    .getByRole("group", { name: "Link lists" })
    .getByRole("button", { name: "Open reports", exact: true })
    .click();
  const report = page.getByRole("row").filter({ hasText: slug });
  await expect(report.getByText("anonymous", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(report.getByText("no match")).toHaveCount(0);
});
