import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { appUrl } from "./environment";
import { queryRows } from "./db";

const password = "test-password-123";

test("walks pages with a cursor, and searches past the first one", async ({ page }) => {
  const email = `paging-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  await page.goto("/links");
  // Not "LIMIT 1": the suite runs in parallel, so that is another test's org
  // and the creates come back 403.
  const [{ id: org }] = await queryRows<{ id: string }>(
    page,
    `SELECT o.id FROM orgs o
       JOIN org_members m ON m.org_id = o.id
       JOIN user u ON u.id = m.user_id
      WHERE u.email = ?`,
    [email],
  );
  for (let i = 0; i < 30; i++) {
    const made = await page.request.post(`${appUrl}/api/orgs/${org}/links`, {
      data: { destination: `https://example.com/paged-${i}`, title: `Paged ${i}` },
    });
    expect(made.ok(), `link ${i}`).toBe(true);
  }

  await page.reload();

  await expect(page.getByText(/^1 to 25( of 30)?$/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/^26 to 30( of 30)?$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByText(/^1 to 25( of 30)?$/)).toBeVisible();

  // The oldest link is on the last page, so a search that finds it proves
  // the search ran against the table rather than the rows on screen.
  await page.getByPlaceholder("Search links").fill("paged-0");
  await expect(page.getByText("Paged 0", { exact: true })).toBeVisible();
});
