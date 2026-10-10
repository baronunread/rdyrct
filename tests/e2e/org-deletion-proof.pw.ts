import { test, expect } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows, rawSql } from "./db";

test("org deletion refuses another org and still works for its owner", async ({ page }) => {
  const stamp = Date.now();
  const email = `proof-delete-${stamp}@gmail.com`;
  await signUpAndVerify(page, email, "test-password-123");
  const otherId = `proof-other-${stamp}`;
  await rawSql(page, "insert into orgs (id, name, created_at) values (?, 'Other', 0)", [otherId]);
  const refused = await page.request.delete(`/api/orgs/${otherId}`);
  expect(refused.status()).toBe(403);
  expect(
    await queryRows(page, "select id from orgs where id = ? and deleting_at is null", [otherId]),
  ).toHaveLength(1);

  await page.goto("/organization");
  const orgName = await page.getByLabel("Organization name").inputValue();
  await page.getByRole("button", { name: "Delete organization" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Delete organization" });
  await dialog.getByLabel(`Type ${orgName} to confirm deletion`).fill(orgName);
  const deleted = page.waitForResponse(
    (res) => res.request().method() === "DELETE" && res.url().includes("/api/orgs/"),
  );
  await dialog.getByRole("button", { name: "Delete organization" }).click();
  expect((await deleted).status()).toBe(200);
  await expect(dialog).not.toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Create an organization" })).toBeVisible();
  await rawSql(page, "delete from orgs where id = ?", [otherId]);
});
