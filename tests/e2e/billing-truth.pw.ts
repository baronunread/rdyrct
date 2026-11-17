import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, queryRows, seedSubscriber } from "./db";
import { SUBSCRIPTION_ACCESS } from "../../src/worker/entitlement";

const ENTITLING = Object.entries(SUBSCRIPTION_ACCESS)
  .filter(([, grants]) => grants)
  .map(([status]) => `'${status}'`)
  .join(", ");

const password = "test-password-123";

const digits = (text: string | null) => Number((text ?? "").replace(/[^0-9]/g, ""));

async function paidUsers(page: Page): Promise<number> {
  const figure = page
    .getByRole("group", { name: "Figure to chart" })
    .getByRole("button", { name: /^Paid/ });
  return digits(await figure.locator(".tnum").first().textContent());
}

async function footnote(page: Page, noun: RegExp): Promise<number> {
  const line = (await page.getByText(/ comped\./).textContent()) ?? "";
  const match = new RegExp(`([\\d,]+) ${noun.source}`).exec(line);
  return match ? digits(match[1]) : NaN;
}
const compedCount = (page: Page) => footnote(page, /comped/);
const subscriberCount = (page: Page) => footnote(page, /subscriptions?/);

// Every other worker gives itself a paying subscription at moments this test cannot
// predict, so the page and the rows are read together until no other test wrote between.
async function expectCountsMatchRows(page: Page) {
  await expect(async () => {
    await page.goto("/admin");
    await expect(page.getByText(/ subscriptions?\./)).toBeVisible();
    const [rows] = await queryRows<{ paying: number; subscribers: number; comped: number }>(
      page,
      `select
         (select count(*) from user where plan != 'free' and comp_plan is null) as paying,
         (select count(*) from user where subscription_plan is not null
            and subscription_status in (${ENTITLING})) as subscribers,
         (select count(*) from user where comp_plan is not null) as comped`,
    );
    expect(await paidUsers(page)).toBe(Number(rows.paying));
    expect(await subscriberCount(page)).toBe(Number(rows.subscribers));
    expect(await compedCount(page)).toBe(Number(rows.comped));
  }).toPass({ timeout: 30_000 });
}

// A comp and a subscription grant the same access (#81), but only one is somebody paying (#82).
test("an admin can comp a user, and the comp never counts as a subscriber", async ({ page }) => {
  const subscriber = `playwright-sub-${Date.now()}@gmail.com`;
  const admin = `playwright-admin-${Date.now()}@gmail.com`;

  await signUpAndVerify(page, admin, password);
  await makePlatformAdmin(page, admin);
  await seedSubscriber(page, subscriber, "pro");

  await page.goto("/admin/users");
  const subscriberRow = page.getByRole("row", { name: new RegExp(subscriber) });
  await expect(subscriberRow).toContainText("pro", { timeout: 10_000 });

  const adminRow = page.getByRole("row", { name: new RegExp(admin) });
  await expect(adminRow).toContainText("free");
  await expect(adminRow).not.toContainText("comped");

  await expectCountsMatchRows(page);

  await page.goto("/admin/users");
  await adminRow.getByRole("button", { name: `Actions for` }).click();
  await page.getByRole("menuitem", { name: "Comp a paid plan" }).click();
  const dialog = page.getByRole("dialog", { name: /^Comp / });
  const reasonField = dialog.getByRole("textbox", { name: "Reason" });
  await dialog.getByRole("button", { name: "Grant comp" }).click();
  await expect(reasonField).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText("Required", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Comp granted")).toHaveCount(0);
  await dialog.getByLabel("Reason").fill("Design partner");
  await dialog.getByRole("button", { name: "Grant comp" }).click();

  await expect(page.getByText("Comp granted")).toBeVisible();
  await expect(adminRow).toContainText("comped");
  await expect(adminRow).toContainText("pro");

  // The reason an admin typed hangs off the badge on hover, not in the row. Asserted hidden
  // first, so a reason that leaked into the row would fail here.
  const reason = page.getByText("Design partner");
  await expect(reason).toBeHidden();
  await adminRow.getByText("comped").hover();
  await expect(reason).toBeVisible();

  // A comp is in the comped count but in neither the paid-users nor the subscriber total.
  // The counts alone cannot say so (a comp that wrote a subscription moves a card and its
  // rows together), so the admin's own row is read too.
  await expectCountsMatchRows(page);
  const [own] = await queryRows<{ plan: string | null; status: string | null }>(
    page,
    "select subscription_plan as plan, subscription_status as status from user where email = ?",
    [admin],
  );
  expect(own).toEqual({ plan: null, status: null });

  await page.goto("/admin/users");
  await adminRow.getByRole("button", { name: `Actions for` }).click();
  await page.getByRole("menuitem", { name: "Revoke comp" }).click();
  await expect(page.getByText("Comp revoked")).toBeVisible();
  await expect(adminRow).toContainText("free");
  await expect(adminRow).not.toContainText("comped");
  await expect(subscriberRow).toContainText("pro");
});
