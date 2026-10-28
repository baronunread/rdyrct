// fallow-ignore-file code-duplication -- specs repeat their setup so each reads on its own
import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, queryRows, rawSql } from "./db";
import { createQuickLink } from "./orgs";

/**
 * The platform screens' frame and the controls the redesign added: one fixed
 * title over the tabs, the usage range in the URL, the figure the chart
 * plots, a list that shows its worst five without dropping the rest, the
 * link filters, and every tab on a phone.
 */

const password = "test-password-123";

async function admin(page: import("@playwright/test").Page, label: string) {
  const email = `${label}-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await makePlatformAdmin(page, email);
  return email;
}

test("the title stays put across the tabs, and the usage range lives in the URL", async ({
  page,
}) => {
  await admin(page, "admin-frame");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible();

  const range = page.getByRole("group", { name: "Range" });
  await expect(range.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
  await range.getByRole("button", { name: "90d" }).click();
  await expect(page).toHaveURL(/[?&]range=90d/);
  await expect(range.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");

  // The chart plots the figure that is picked, and says which.
  const figures = page.getByRole("group", { name: "Figure to chart" });
  await expect(figures.getByRole("button", { name: /^Users/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Sign-ups per day")).toBeVisible();
  await figures.getByRole("button", { name: /^Organizations/ }).click();
  await expect(figures.getByRole("button", { name: /^Organizations/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("New organizations per day")).toBeVisible();

  // Another tab: the same title in the same place, and no range control.
  const title = await page.getByRole("heading", { level: 1, name: "Platform" }).boundingBox();
  await page
    .getByRole("navigation", { name: "Platform sections" })
    .getByRole("link", { name: "Users" })
    .click();
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(page.getByRole("heading", { name: "Users" })).toBeAttached();
  expect(await page.getByRole("heading", { level: 1, name: "Platform" }).boundingBox()).toEqual(
    title,
  );
  await expect(page.getByRole("group", { name: "Range" })).toHaveCount(0);
});

test("over or near their plan shows the worst five, and every row on request", async ({ page }) => {
  await admin(page, "admin-caps");
  // Eight orgs pressing on their plan, whatever the local database holds.
  await page.route("**/api/admin/usage*", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.capPressure = Array.from({ length: 8 }, (_, i) => ({
      orgId: `cap-${i}`,
      orgName: `Cap Org ${i}`,
      plan: "free",
      linksPct: 50 + i * 20,
      membersPct: 10,
      domainsPct: 0,
    }));
    await route.fulfill({ response, json });
  });
  await page.goto("/admin");

  await expect(page.getByText("Showing 5 of 8")).toBeVisible({ timeout: 10_000 });
  // Worst first: 190% is on show, 50% waits behind the button.
  await expect(page.getByRole("cell", { name: "Cap Org 7" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Cap Org 0" })).toHaveCount(0);

  const more = page.getByRole("button", { name: "Show all 8" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(page.getByRole("cell", { name: "Cap Org 0" })).toBeVisible();
  await expect(page.getByText("Showing 8 of 8")).toBeVisible();
});

test("a reported link says so, and the Reported filter finds it", async ({ page }) => {
  const email = `admin-reported-${Date.now()}@gmail.com`;
  const destination = `https://reported-filter-${Date.now()}.example/page`;
  await signUpAndVerify(page, email, password);
  await createQuickLink(page, destination);
  await makePlatformAdmin(page, email);
  const [link] = await queryRows<{ id: string; slug: string; org_id: string }>(
    page,
    "select id, slug, org_id from links where destination = ?",
    [destination],
  );
  await rawSql(
    page,
    "insert into link_reports (id, slug, link_id, org_id, reason, created_at) values (?, ?, ?, ?, 'phishing', ?)",
    [`report-${Date.now()}`, link.slug, link.id, link.org_id, Date.now()],
  );

  await page.goto(`/admin/links?org=${link.org_id}`);
  const row = page.getByRole("row").filter({ hasText: link.slug });
  await expect(row.getByText("Reported", { exact: true })).toBeVisible({ timeout: 10_000 });

  const lists = page.getByRole("group", { name: "Link lists" });
  await lists.getByRole("button", { name: "Suspended", exact: true }).click();
  await expect(row).toHaveCount(0);
  await lists.getByRole("button", { name: "Reported", exact: true }).click();
  await expect(row).toBeVisible();
  // The host and slug share one line.
  expect((await row.boundingBox())!.height).toBeLessThan(56);
});

test("every platform tab fits a phone", async ({ page }) => {
  await admin(page, "admin-phone");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/admin", "/admin/users", "/admin/orgs", "/admin/links", "/admin/audit"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0, { timeout: 10_000 });
    const overflow = await page.evaluate(() => {
      const page = document.documentElement.scrollWidth - window.innerWidth;
      // A table folds into a list on a phone, so its card never scrolls
      // sideways either.
      const tables = [...document.querySelectorAll("table")].map(
        (t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth,
      );
      return Math.max(page, ...tables);
    });
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
