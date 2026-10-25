// fallow-ignore-file code-duplication -- specs repeat their setup so each reads on its own
import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, queryRows } from "./db";
import { createQuickLink } from "./orgs";

const password = "test-password-123";

test("a scam-shaped destination is created paused, and the owner can see that", async ({
  page,
}) => {
  await signUpAndVerify(page, `hold-${Date.now()}@gmail.com`, password);
  const destination = `https://phonepewheel-${Date.now()}.up.railway.app/`;
  await createQuickLink(page, destination);

  const [link] = await queryRows<{ slug: string; suspended_at: number | null }>(
    page,
    "select slug, suspended_at from links where destination = ?",
    [destination],
  );
  expect(link.suspended_at).not.toBeNull();
  // It does not redirect.
  expect((await page.request.get(`/${link.slug}`, { maxRedirects: 0 })).status()).not.toBe(302);

  await page.goto("/links");
  await expect(page.getByText("paused")).toBeVisible({ timeout: 10_000 });
});

test("banning an org's owner disables its links, blocks only the host picked, and an unban undoes it", async ({
  page,
  browser,
}) => {
  const abuserEmail = `abuser-${Date.now()}@gmail.com`;
  const host = `scam-${Date.now()}.example`;
  const abuser = await (await browser.newContext()).newPage();
  await signUpAndVerify(abuser, abuserEmail, password);
  await createQuickLink(abuser, `https://${host}/spin`);
  await createQuickLink(abuser, "https://www.google.com/maps");
  const [link] = await queryRows<{ slug: string }>(
    abuser,
    "select slug from links where destination = ?",
    [`https://${host}/spin`],
  );

  const admin = `ban-admin-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, admin, password);
  await makePlatformAdmin(page, admin);

  await page.goto("/admin/orgs");
  const row = page.getByRole("row").filter({ hasText: abuserEmail });
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: /Ban owner/ }).click();
  const dialog = page.getByRole("dialog", { name: "Ban user" });
  // Says what it will do before it does it, and needs a reason.
  await expect(dialog.getByText(/deleted in 90 days/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Ban user" })).toBeDisabled();
  // Nothing is blocked unless picked, and a site everyone uses cannot be.
  const scamBox = dialog.getByRole("checkbox", { name: host });
  await expect(scamBox).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "google.com" })).toBeDisabled();
  await scamBox.check();
  await dialog.getByLabel("Reason").fill("spin-to-win scam");
  await dialog.getByRole("button", { name: "Ban user" }).click();
  await expect(
    page.getByText(/is banned\. 1 organization disabled\. 1 host blocked\./),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(row.getByText("disabled")).toBeVisible();

  // The short link answers the disabled page, not the scam.
  await expect
    .poll(async () => (await page.request.get(`/${link.slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
    })
    .toBe(410);
  const disabled = await page.request.get(`/${link.slug}`, { maxRedirects: 0 });
  expect(await disabled.text()).toContain("This link has been disabled.");

  // The picked host is on the list, with the reason; google.com is not.
  await page.goto("/admin/links");
  await page.getByRole("button", { name: "Blocked hosts", exact: true }).click();
  const blocked = page.getByRole("row").filter({ hasText: host });
  await expect(blocked).toBeVisible({ timeout: 10_000 });
  await expect(blocked.getByText(/spin-to-win scam/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "google.com" })).toHaveCount(0);

  // An unban brings the link back.
  await page.goto("/admin/users");
  const userRow = page.getByRole("row").filter({ hasText: abuserEmail });
  await userRow.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Unban user" }).click();
  await page
    .getByRole("dialog", { name: "Unban user" })
    .getByRole("button", { name: "Unban user" })
    .click();
  await expect
    .poll(async () => (await page.request.get(`/${link.slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
    })
    .toBe(302);
});

test("the terms say how to report abuse and how to appeal", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Reporting abuse and appeals" })).toBeVisible();
  await expect(page.getByRole("link", { name: "report form" })).toHaveAttribute("href", "/report");
});

test("the landing shortener refuses a scam-shaped destination and says why", async ({ page }) => {
  await page.goto("/");
  const field = page.getByLabel("Shorten a link, no account needed");
  await field.fill(`https://phonepewheel-${Date.now()}.up.railway.app/`);
  await field.press("Enter");
  await expect(page.getByText(/looks like a scam page/)).toBeVisible({ timeout: 15_000 });
});
