import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { appUrl } from "./environment";
import { queryRows } from "./db";
import { createQuickLink } from "./orgs";

const password = "test-password-123";

/** This account's organization: the suite runs in parallel, so "the first
 * org" is somebody else's. */
async function orgOf(page: Page, email: string) {
  const [{ id }] = await queryRows<{ id: string }>(
    page,
    `SELECT o.id FROM orgs o
       JOIN org_members m ON m.org_id = o.id
       JOIN user u ON u.id = m.user_id
      WHERE u.email = ?`,
    [email],
  );
  return id;
}

/**
 * The links table's own actions (the redesign): ticking rows brings up a bar
 * that downloads their QR codes or deletes them, and every delete, one or
 * many, asks for the slug (or "delete") to be typed first.
 */
test("ticked rows download their QR codes and delete together; one link asks for its slug", async ({
  page,
}) => {
  const email = `links-bulk-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await page.goto("/links");
  const org = await orgOf(page, email);
  for (let i = 0; i < 3; i++) {
    const made = await page.request.post(`${appUrl}/api/orgs/${org}/links`, {
      data: { destination: `https://example.com/bulk-${i}`, title: `Bulk ${i}` },
    });
    expect(made.ok(), `link ${i}`).toBe(true);
  }
  await page.reload();
  await page
    .getByRole("region", { name: "Cookie consent" })
    .getByRole("button", { name: "Reject" })
    .click();

  // One link from its row menu: the dialog names it and wants its slug.
  const row = page.getByRole("row", { name: /Bulk 0/ });
  await row.hover();
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Delete link" }).click();
  const one = page.getByRole("dialog", { name: /^Delete .+\/.+\?$/ });
  await expect(one.getByText(/stop working at once, including printed copies/)).toBeVisible();
  const slugField = one.getByRole("textbox", { name: "Type the slug to confirm" });
  // The field, not the close button, has the focus.
  await expect(slugField).toBeFocused();
  // A wrong slug marks the field and keeps the dialog open.
  await slugField.fill("not-it");
  await one.getByRole("button", { name: "Delete link" }).click();
  await expect(slugField).toHaveAttribute("aria-invalid", "true");
  await expect(one.getByText("Doesn't match")).toBeVisible();
  const slug = await slugField.getAttribute("placeholder");
  await slugField.fill(slug ?? "");
  await one.getByRole("button", { name: "Delete link" }).click();
  await expect(page.getByText("Link deleted")).toBeVisible();
  await expect(page.getByRole("row", { name: /Bulk 0/ })).toHaveCount(0);

  // The other two, ticked.
  await page.getByRole("checkbox", { name: "Select every link on this page" }).check();
  const bar = page.getByRole("toolbar", { name: "Selected links" });
  await expect(bar.getByText("2 selected")).toBeVisible();
  // The bar takes the toolbar's place, so the search is gone while it shows.
  await expect(page.getByPlaceholder("Search links")).toBeHidden();

  const download = page.waitForEvent("download");
  await bar.getByRole("button", { name: /QR codes/ }).click();
  expect((await download).suggestedFilename()).toBe("qr-codes-2.zip");

  await bar.getByRole("button", { name: "Delete" }).click();
  const many = page.getByRole("dialog", { name: "Delete 2 links?" });
  await many.getByRole("button", { name: "Delete 2 links" }).click();
  await expect(many.getByText("Required")).toBeVisible();
  await many.getByRole("textbox", { name: "Type delete to confirm" }).fill("delete");
  await many.getByRole("button", { name: "Delete 2 links" }).click();
  await expect(page.getByText("2 links deleted")).toBeVisible();

  // Nothing left: the empty state, with no search box over it and the
  // import offered beside New link.
  await expect(page.getByRole("heading", { name: "No links yet" })).toBeVisible();
  await expect(page.getByPlaceholder("Search links")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Or import from Bitly, Short.io, Rebrandly or Dub" }),
  ).toBeVisible();
});

test("a read-only organization keeps Import and New link on screen, greyed, and still exports", async ({
  page,
}) => {
  const email = `links-locked-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  // One link, so the page is the table rather than the empty state.
  await page.goto("/links");
  const made = await page.request.post(`${appUrl}/api/orgs/${await orgOf(page, email)}/links`, {
    data: { destination: "https://example.com/locked" },
  });
  expect(made.ok()).toBe(true);
  // The lock is the server's to set (a downgrade does it); here the user
  // answer says so, which is all the page reads.
  await page.route("**/api/user", async (route) => {
    const response = await route.fetch();
    // SAFETY: this route is GET /api/user, whose body always carries the orgs list.
    const user = (await response.json()) as { orgs: { locked: boolean }[] };
    for (const org of user.orgs) org.locked = true;
    await route.fulfill({ response, json: user });
  });
  await page.goto("/links");

  await expect(
    page.getByText("You can still export: it is how you take your links with you."),
  ).toBeVisible();
  for (const name of [/New link/, /^Import$/]) {
    const button = page.getByRole("button", { name }).first();
    await expect(button).toHaveAttribute("aria-disabled", "true");
  }
  await page
    .getByRole("button", { name: /New link/ })
    .first()
    .hover();
  await expect(page.getByText("This organization is read-only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();
});

test("the chips above the links table count and filter", async ({ page }) => {
  await signUpAndVerify(page, `links-chips-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "example.com/chips-one");
  await page.keyboard.press("Escape");
  await createQuickLink(page, "example.com/chips-two");
  await page.keyboard.press("Escape");

  await page.goto("/links");
  const chips = page.getByRole("group", { name: "Show" });
  await expect(chips.getByRole("button", { name: "All 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Two fresh links: neither needs a look, and neither has a QR look of its own.
  await expect(chips.getByRole("button", { name: "Needs attention 0" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Last 7 days" })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(2);

  await chips.getByRole("button", { name: "QR codes 0" }).click();
  await expect(page.getByText("Try another word, or clear the filters.")).toBeVisible();

  await chips.getByRole("button", { name: "All 2" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
});
