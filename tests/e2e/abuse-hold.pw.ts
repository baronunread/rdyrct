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

test("marking an org as abuse stops it, bans the owner and blocks its hosts, until unblocked", async ({
  page,
  browser,
}) => {
  const victimEmail = `abuser-${Date.now()}@gmail.com`;
  const host = `scam-${Date.now()}.example`;
  const victim = await (await browser.newContext()).newPage();
  await signUpAndVerify(victim, victimEmail, password);
  await createQuickLink(victim, `https://${host}/spin`);

  const admin = `abuse-admin-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, admin, password);
  await makePlatformAdmin(page, admin);

  await page.goto("/admin/orgs");
  const row = page.getByRole("row").filter({ hasText: victimEmail });
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: /Mark as abuse/ }).click();
  const dialog = page.getByRole("dialog", { name: "Mark as abuse" });
  // Says what it will do before it does it, and needs a reason.
  await expect(dialog.getByText(/ban its owner/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mark as abuse" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("spin-to-win scam");
  await dialog.getByRole("button", { name: "Mark as abuse" }).click();
  await expect(page.getByText(/Marked as abuse\. 1 links stopped, 1 hosts blocked/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(row.getByText("suspended")).toBeVisible();

  // The host is on the list, with the reason.
  await page.goto("/admin/links");
  await page.getByRole("button", { name: "Blocked hosts", exact: true }).click();
  const blocked = page.getByRole("row").filter({ hasText: host });
  await expect(blocked).toBeVisible({ timeout: 10_000 });
  await expect(blocked.getByText(/spin-to-win scam/)).toBeVisible();

  // And a mistake can be undone.
  await blocked.getByRole("button", { name: `Unblock ${host}` }).click();
  await expect(blocked).toHaveCount(0, { timeout: 10_000 });
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
