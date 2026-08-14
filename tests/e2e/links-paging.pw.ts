import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { appUrl } from "./environment";
import { queryRows } from "./db";

const password = "test-password-123";

/**
 * Paging the links table (#19).
 *
 * The table asks for one page and the server decides what is on it, so the
 * things worth checking in a browser are that the controls walk pages
 * rather than slices, and that a search reaches links no page has shown.
 */
test("walks pages with a cursor, and searches past the first one", async ({ page }) => {
  const email = `paging-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  // Thirty links through the API rather than thirty trips through the
  // dialog: what is under test is reading them back a page at a time.
  await page.goto("/links");
  const [{ id: org }] = await queryRows<{ id: string }>(page, "SELECT id FROM orgs LIMIT 1");
  for (let i = 0; i < 30; i++) {
    const made = await page.request.post(`${appUrl}/api/orgs/${org}/links`, {
      data: { destination: `https://example.com/paged-${i}`, title: `Paged ${i}` },
    });
    expect(made.ok(), `link ${i}`).toBe(true);
  }

  await page.reload();

  // A page, not the table: twenty-five rows and a way forward.
  await expect(page.getByText("Page 1")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Page 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByText("Page 1")).toBeVisible();

  // The oldest link is on the last page, so a search that finds it proves
  // the search ran against the table rather than the rows on screen.
  await page.getByPlaceholder("Search links…").fill("paged-0");
  await expect(page.getByText("Paged 0", { exact: true })).toBeVisible();
});
