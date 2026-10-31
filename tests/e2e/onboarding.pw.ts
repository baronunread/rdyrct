import { expect, test, type Page } from "@playwright/test";
import { enterCode, signUpAndVerify, submitSignup } from "./resend";
import { queryRows, setPlan } from "./db";
import { createQuickLink } from "./orgs";

/**
 * A new organization's setup flow (components/setup-flow.tsx, on
 * /welcome): its name, its first link, a domain of its own, its team, with
 * the organization card filling in beside the questions. Polar's side is
 * stubbed at the browser, the way the billing specs do it; Google's return
 * is the URL it comes back to.
 */

const password = "test-password-123";

const card = (page: Page) => page.getByRole("complementary", { name: "Your organization" });
const heading = (page: Page, name: string) => page.getByRole("heading", { name });

test("an email sign-up names its organization, makes a link, and arrives in the app", async ({
  page,
}) => {
  const email = `onboard-${Date.now()}@example.org`;
  await submitSignup(page, email, password);
  await expect(heading(page, "Check your email")).toBeVisible({ timeout: 30_000 });
  await enterCode(page, email);

  // The flow, with the organization card beside it, named from the domain.
  await expect(heading(page, "What should we call your organization?")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(card(page)).toContainText("Example");
  await expect(card(page)).toContainText("go.example.org");

  // The card renames as the name is typed, and the name is saved.
  const name = page.getByRole("textbox", { name: "Name" });
  await name.fill("Acme Coffee");
  await expect(card(page)).toContainText("Acme Coffee");
  await page.getByRole("button", { name: "Continue" }).click();

  // The first link lands in the card, with its QR code.
  await expect(heading(page, "Shorten your first link")).toBeVisible();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("textbox", { name: "Long link" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByRole("textbox", { name: "Long link" }).fill("https://example.org/spring-menu");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(card(page)).not.toContainText("Shows here once made");
  await expect(card(page)).toContainText("example.org/spring-menu");
  await page.getByRole("button", { name: "Continue" }).click();

  // Free: the domain step shows the link on a domain of their own.
  await expect(heading(page, "Use your own domain")).toBeVisible();
  await expect(page.getByText("go.example.org/spring-menu")).toBeVisible();
  await expect(page.getByRole("button", { name: /Hobby, \$4 a month/ })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();

  // The team step marks a wrong address instead of sending.
  await expect(heading(page, "Invite your team")).toBeVisible();
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByRole("button", { name: "Not now" }).click();

  // Into the app, as a dashboard, under the new name.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(heading(page, "Dashboard")).toBeVisible();
  await expect(page.getByTitle("Switch organization")).toContainText("Acme Coffee");
  const [org] = await queryRows<{ name: string }>(
    page,
    "select o.name from orgs o join org_members m on m.org_id = o.id join user u on u.id = m.user_id where u.email = ?",
    [email],
  );
  expect(org.name).toBe("Acme Coffee");

  // Done is done: /welcome moves straight on.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("an account that already has links never gets the flow", async ({ page }) => {
  await signUpAndVerify(page, `onboard-old-${Date.now()}@example.org`, password);
  await createQuickLink(page, "https://example.org/before");
  await page.keyboard.press("Escape");

  await page.goto("/welcome?via=email&next=%2Fdashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(heading(page, "Dashboard")).toBeVisible();
  await expect(heading(page, "What should we call your organization?")).toHaveCount(0);
});

test("a pricing link goes to checkout, and going back still sets the organization up", async ({
  page,
}) => {
  await signUpAndVerify(page, `onboard-cancel-${Date.now()}@example.org`, password);

  // Polar stands in: its back button lands on the URL the worker gave it.
  const asked: unknown[] = [];
  await page.route("**/api/billing/checkout", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "/welcome?checkout=cancelled&plan=pro&interval=year" } });
  });

  await page.goto("/welcome?plan=pro&interval=year");
  // Two full page loads: to checkout and back.
  await expect(heading(page, "No charge made")).toBeVisible({ timeout: 15_000 });
  expect(asked).toEqual([{ plan: "pro", interval: "year", from: "welcome" }]);

  // The flow follows, and its domain step offers the plan they picked.
  await expect(heading(page, "What should we call your organization?")).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("button", { name: /Pro, \$9 a month/ })).toBeVisible();
});

test("back from a paid checkout, the domain step asks for the domain", async ({ page }) => {
  const email = `onboard-paid-${Date.now()}@example.org`;
  await signUpAndVerify(page, email, password);
  // The webhook, landed: what Polar's success URL comes back to.
  await setPlan(page, email, "pro");

  await page.goto("/welcome?checkout_id=test&plan=pro");
  await expect(heading(page, "Pro is on")).toBeVisible({ timeout: 15_000 });
  await expect(heading(page, "What should we call your organization?")).toBeVisible();
  await expect(card(page)).toContainText("Pro");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("textbox", { name: "Domain" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add domain" })).toBeVisible();
});

test("back from Google: a new account gets the flow, a returning one goes in", async ({ page }) => {
  await signUpAndVerify(page, `onboard-google-${Date.now()}@gmail.com`, password);

  // Where Google sends a new account (routes/auth.tsx, newUserCallbackURL).
  await page.goto("/welcome?via=google&signup=google&next=%2Fdashboard");
  await expect(heading(page, "Account created")).toBeVisible();
  await expect(heading(page, "What should we call your organization?")).toBeVisible();
  // A Gmail address names no company: the example domain stays generic.
  await expect(card(page)).toContainText("go.yourbrand.com");

  // A returning sign-in only says so, and goes on into the app.
  await page.goto("/welcome?via=google&next=%2Fdashboard");
  await expect(heading(page, "Signed in with Google")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a signed-out pricing link signs up through /welcome", async ({ page }) => {
  await page.goto("/pricing");
  await expect(
    page.locator('[data-plan="pro"]').getByRole("link", { name: "Start Pro" }),
  ).toHaveAttribute("href", /\/signup\?next=%2Fwelcome%3Fplan%3Dpro/);
});
