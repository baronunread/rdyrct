import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { createQuickLink } from "./orgs";

/**
 * A new organization's setup list (components/setup-list.tsx): the first
 * link, a domain of their own, the team, and the plan for somebody who came
 * in through a pricing link. The welcome screen between a pricing link and
 * the app is routes/welcome.tsx; Polar's side is stubbed at the browser, the
 * way the billing specs do it.
 */

const password = "test-password-123";

const list = (page: Page) =>
  page.getByRole("list").filter({ has: page.getByText("Invite your team") });
const step = (page: Page, title: string) =>
  list(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title }) });
const progress = (page: Page) => page.getByRole("progressbar", { name: "Setup" });

/** A signed-in account whose browser has not started a list yet, as one
 * arriving at /welcome from a pricing link would be. */
async function arrivingAccount(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.org`;
  await signUpAndVerify(page, email, password);
  await page.evaluate(() => localStorage.removeItem("rdyrct:setup:v1"));
  return email;
}

test("a new account is set up from one list, and the list stays gone once done", async ({
  page,
}) => {
  const email = `onboard-${Date.now()}@example.org`;
  await signUpAndVerify(page, email, password);

  // The welcome, named after the address's domain, with the link step open.
  await expect(page.getByRole("heading", { name: "Welcome to Example" })).toBeVisible();
  await expect(page.getByText("Named after example.org.")).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");
  await expect(progress(page)).toHaveAttribute("aria-valuemax", "3");
  await expect(step(page, "Use your own domain")).toContainText("Paid");

  await createQuickLink(page, "https://example.org/spring-menu");
  await page.keyboard.press("Escape");

  // Free: the domain step shows their own link next to the same link on a
  // domain of their own, with the slug they would choose.
  const domain = step(page, "Use your own domain");
  await expect(step(page, "Shorten a link").locator(".font-mono").first()).toHaveText(
    /\/[A-Za-z0-9]+$/,
  );
  await expect(domain.getByText("Now")).toBeVisible();
  await expect(domain.getByText("go.example.org/spring-menu")).toBeVisible();
  await expect(domain.getByRole("button", { name: "Upgrade" })).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "1");

  // Put off, it closes on "Later" and the team step opens.
  await domain.getByRole("button", { name: "Later" }).click();
  await expect(domain).toContainText("Later");
  const team = step(page, "Invite your team");
  await expect(team.getByRole("textbox", { name: "Email" })).toBeVisible();

  // A wrong address marks the field instead of sending.
  await team.getByRole("button", { name: "Invite" }).click();
  await expect(team.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await team.getByRole("textbox", { name: "Email" }).fill(`sam-${Date.now()}@example.org`);
  await team.getByRole("button", { name: "Invite" }).click();

  // Every step done or put off: the list and its count leave, and a reload
  // does not bring them back.
  await expect(list(page)).toHaveCount(0);
  await expect(progress(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(list(page)).toHaveCount(0);
});

test("an account that already has links never gets the list", async ({ page }) => {
  const email = `onboard-old-${Date.now()}@example.org`;
  await signUpAndVerify(page, email, password);
  await createQuickLink(page, "https://example.org/before");
  await page.keyboard.press("Escape");

  // As this browser would be for somebody who signed up before the list.
  await page.evaluate(() => localStorage.removeItem("rdyrct:setup:v1"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(progress(page)).toHaveCount(0);
  await expect(page.getByText("Get set up")).toHaveCount(0);
});

test("an existing account coming back through /welcome keeps its dashboard", async ({ page }) => {
  await arrivingAccount(page, "onboard-existing");
  await createQuickLink(page, "https://example.org/already");
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.removeItem("rdyrct:setup:v1"));

  // A pricing link followed by somebody who already had links, then a
  // cancelled checkout: no list, and the card does not promise one.
  await page.goto("/welcome?checkout=cancelled&plan=pro");
  await expect(page.getByText("Upgrade any time from Billing.")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(progress(page)).toHaveCount(0);
  await expect(page.getByText("Get set up")).toHaveCount(0);
});

test("a pricing link goes to checkout, and going back leaves the upgrade as the first step", async ({
  page,
}) => {
  await arrivingAccount(page, "onboard-cancel");

  // Polar stands in: its back button lands on the URL the worker gave it.
  const asked: unknown[] = [];
  await page.route("**/api/billing/checkout", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "/welcome?checkout=cancelled&plan=pro&interval=year" } });
  });

  await page.goto("/welcome?plan=pro&interval=year");
  await expect(page.getByRole("heading", { name: "No charge made" })).toBeVisible();
  expect(asked).toEqual([{ plan: "pro", interval: "year", from: "welcome" }]);

  await expect(page).toHaveURL(/\/dashboard$/);
  const upgrade = step(page, "Finish upgrading to Pro");
  await expect(upgrade).toContainText("$8.10 a month, billed yearly");
  await expect(upgrade.getByRole("button", { name: "Continue to checkout" })).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuemax", "4");

  await upgrade.getByRole("button", { name: "Later" }).click();
  await expect(upgrade).toContainText("Later");
  await expect(
    step(page, "Shorten a link").getByPlaceholder("https://example.com/launch"),
  ).toBeVisible();
});

test("back from a paid checkout, the plan is the first step, already done", async ({ page }) => {
  const email = await arrivingAccount(page, "onboard-paid");
  // The webhook, landed: what Polar's success URL comes back to.
  await setPlan(page, email, "pro");

  await page.goto("/welcome?checkout_id=test&plan=pro");
  await expect(page.getByRole("heading", { name: "Pro is on" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);

  await expect(step(page, "Pro is on")).toContainText("$9 a month");
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "1");
  await expect(progress(page)).toHaveAttribute("aria-valuemax", "4");
  // Paid, so the domain step asks for the domain instead of selling one.
  await expect(step(page, "Use your own domain")).not.toContainText("Paid");
});

test("a signed-out pricing link signs up through /welcome", async ({ page }) => {
  await page.goto("/pricing");
  await expect(
    page.locator('[data-plan="pro"]').getByRole("link", { name: "Start Pro" }),
  ).toHaveAttribute("href", /\/signup\?next=%2Fwelcome%3Fplan%3Dpro/);
});
