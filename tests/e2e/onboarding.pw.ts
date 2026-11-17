import { expect, test, type Page } from "@playwright/test";
import { enterCode, signUpAndVerify, skipSetup, submitSignup } from "./resend";
import { queryRows, setPlan } from "./db";
import { createQuickLink } from "./orgs";

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

  await expect(heading(page, "What should we call your organization?")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(card(page)).toContainText("Example");
  await expect(card(page)).toContainText("go.example.org");

  const name = page.getByRole("textbox", { name: "Name" });
  await name.fill("Acme Coffee");
  await expect(card(page)).toContainText("Acme Coffee");
  await page.getByRole("button", { name: "Continue" }).click();

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
  await expect(page.getByRole("button", { name: "Link created" })).toBeDisabled();

  const open = card(page).getByRole("link", { name: "Open it" });
  const slug = new URL((await open.getAttribute("href"))!).pathname;
  const res = await page.request.get(slug, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  await expect(card(page)).toContainText("1 click", { timeout: 30_000 });

  await expect(heading(page, "Use your own domain")).toBeVisible();
  await expect(page.getByText("go.example.org/spring-menu")).toBeVisible();
  await expect(page.getByRole("button", { name: /Hobby, \$4 a month/ })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();

  await expect(heading(page, "Invite your team")).toBeVisible();
  const emails = page.getByRole("textbox", { name: "Emails" });
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(emails).toHaveAttribute("aria-invalid", "true");
  await emails.fill("sam@example.org nope ");
  await page.getByRole("button", { name: "Send 2 invites" }).click();
  await expect(page.getByText("Not an email: nope")).toBeVisible();
  await page.getByRole("button", { name: "Remove nope" }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("1 invite sent.")).toBeVisible();
  await expect(card(page)).toContainText("1 invited");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(heading(page, "What should we email you about?")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Product news" })).not.toBeChecked();
  await page.getByRole("switch", { name: "Offers" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(heading(page, "Dashboard")).toBeVisible();
  await expect(page.locator("[data-org-switcher]").first()).toContainText("Acme Coffee");
  const [org] = await queryRows<{ name: string }>(
    page,
    "select o.name from orgs o join org_members m on m.org_id = o.id join user u on u.id = m.user_id where u.email = ?",
    [email],
  );
  expect(org.name).toBe("Acme Coffee");
  const [consent] = await queryRows<{ news: number | null; offers: number | null; source: string }>(
    page,
    "select news_opt_in_at as news, offers_opt_in_at as offers, offers_opt_in_source as source from user where email = ?",
    [email],
  );
  expect(consent).toMatchObject({ news: null, source: "onboarding" });
  expect(consent.offers).not.toBeNull();
  await expect(page.getByRole("dialog", { name: "What should we email you about?" })).toHaveCount(
    0,
  );

  await expect(page.getByRole("button", { name: /Account menu/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Finish setting up/ })).toHaveCount(0);

  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("skipping the email step answers no to both lists", async ({ page }) => {
  const email = `onboard-email-skip-${Date.now()}@example.org`;
  await page.request.post("/__dev/test-account", { data: { email, password, asked: false } });
  await page.goto("/welcome");
  await skipSetup(page);
  await expect(heading(page, "Dashboard")).toBeVisible();
  const [row] = await queryRows<{ news: number | null; offers: number | null; asked: number }>(
    page,
    "select news_opt_in_at as news, offers_opt_in_at as offers, marketing_asked_at as asked from user where email = ?",
    [email],
  );
  expect(row).toMatchObject({ news: null, offers: null });
  expect(row.asked).not.toBeNull();
  await expect(page.getByRole("dialog", { name: "What should we email you about?" })).toHaveCount(
    0,
  );
});

test("what is left of the setup waits in the sidebar", async ({ page }) => {
  await signUpAndVerify(page, `onboard-list-${Date.now()}@example.org`, password);
  await page.goto("/welcome");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("textbox", { name: "Long link" }).fill("https://example.org/list");
  await page.getByRole("button", { name: "Create link" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(heading(page, "Invite your team")).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(heading(page, "Dashboard")).toBeVisible();

  const setup = page.getByRole("button", { name: /Finish setting up/ });
  await expect(setup).toContainText("1 of 3");
  await expect(setup).toContainText("Next: Get its first click");
  await setup.click();
  const list = page.getByRole("dialog", { name: "Finish setting up" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list).toContainText("within about 10 seconds");

  await list.getByRole("button", { name: "Hide this list" }).click();
  await expect(setup).toHaveCount(0);
  await page.reload();
  await expect(heading(page, "Dashboard")).toBeVisible();
  await expect(setup).toHaveCount(0);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Setup guide/ }).click();
  await expect(setup).toContainText("1 of 3");

  const user = await (await page.request.get("/api/user")).json();
  const made = await page.request.post(`/api/orgs/${user.orgs[0].id}/invites`, {
    data: { role: "member" },
  });
  expect(made.status()).toBe(201);
  await page.reload();
  await expect(setup).toContainText("2 of 3");
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

  const asked: unknown[] = [];
  await page.route("**/api/billing/checkout", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "/welcome?checkout=cancelled&plan=pro&interval=year" } });
  });

  await page.goto("/welcome?plan=pro&interval=year");
  await expect(heading(page, "No charge made")).toBeVisible({ timeout: 15_000 });
  expect(asked).toEqual([{ plan: "pro", interval: "year", from: "welcome" }]);

  await expect(heading(page, "What should we call your organization?")).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("No payment went through.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pro, $8.10 a month, billed yearly" }),
  ).toBeVisible();
});

test("a domain typed before checkout is added when they come back paid", async ({ page }) => {
  const email = `onboard-host-${Date.now()}@example.org`;
  await signUpAndVerify(page, email, password);

  const asked: unknown[] = [];
  await page.route("**/api/billing/checkout", async (route) => {
    asked.push(route.request().postDataJSON());
    await setPlan(page, email, "hobby");
    await route.fulfill({ json: { url: "/welcome?checkout_id=test&plan=hobby" } });
  });
  const added = {
    id: "dom-onboard",
    hostname: "go.example.org",
    status: "checking_dns",
    statusReason: "",
    rootRedirect: "",
    validation: "http",
    createdAt: Date.now(),
    lockedAt: null,
  };
  const posted: unknown[] = [];
  await page.route("**/api/orgs/*/domains", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: added });
  });
  await page.route("**/api/orgs/*/domains/dom-onboard/records", (route) =>
    route.fulfill({
      json: { records: [{ type: "CNAME", name: "go.example.org", value: "rdyrct.test" }] },
    }),
  );

  await page.goto("/welcome");
  await expect(heading(page, "What should we call your organization?")).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Skip" }).click();

  const domain = page.getByRole("textbox", { name: "Domain" });
  await domain.fill("not a domain");
  await page.getByRole("button", { name: /^Hobby, \$4 a month$/ }).click();
  await expect(domain).toHaveAttribute("aria-invalid", "true");
  await domain.fill("go.example.org");
  await expect(page.getByText("go.example.org/launch")).toBeVisible();
  await page.getByRole("button", { name: "Yearly, save 10%" }).click();
  await page.getByRole("button", { name: "Add go.example.org with Hobby" }).click();

  await expect(heading(page, "go.example.org is yours")).toBeVisible({ timeout: 15_000 });
  expect(asked).toEqual([{ plan: "hobby", interval: "year", from: "welcome" }]);
  await expect(heading(page, "Hobby is on")).toHaveCount(0);
  expect(posted).toEqual([{ hostname: "go.example.org" }]);
  await expect(page.getByText("rdyrct.test").filter({ visible: true })).toBeVisible();
  await expect(card(page)).toContainText("Checking DNS");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "Invite your team")).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy invite link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/invite\/\w+/);
});

test("the domain step holds until the payment lands, then goes on", async ({ page }) => {
  const email = `onboard-wait-${Date.now()}@example.org`;
  await signUpAndVerify(page, email, password);
  // Polar sends them back before its webhook arrives.
  await page.route("**/api/billing/checkout", (route) =>
    route.fulfill({ json: { url: "/welcome?checkout_id=test&plan=hobby" } }),
  );

  await page.goto("/welcome");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: /^Hobby, \$4 a month$/ }).click();

  await expect(page.getByText("Confirming your payment")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Hobby, \$4 a month$/ })).toBeDisabled();
  await setPlan(page, email, "hobby");
  await expect(heading(page, "Hobby is on")).toBeVisible({ timeout: 15_000 });
  await expect(heading(page, "Invite your team")).toBeVisible({ timeout: 15_000 });
});

test("back from a paid checkout, the domain step asks for the domain", async ({ page }) => {
  const email = `onboard-paid-${Date.now()}@example.org`;
  await signUpAndVerify(page, email, password);
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

  await page.goto("/welcome?via=google&signup=google&next=%2Fdashboard");
  await expect(heading(page, "Account created")).toBeVisible();
  await expect(heading(page, "What should we call your organization?")).toBeVisible();
  await expect(card(page)).toContainText("go.yourbrand.com");

  await page.goto("/dashboard");
  await createQuickLink(page, "https://example.org/set-up");
  await page.keyboard.press("Escape");
  await page.goto("/welcome?via=google&next=%2Fdashboard");
  await expect(heading(page, "Signed in with Google")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a signed-out pricing link signs up through /welcome", async ({ page }) => {
  await page.goto("/pricing");
  await expect(
    page.locator('[data-plan="pro"]').getByRole("link", { name: "Start Pro" }),
  ).toHaveAttribute("href", /\/signup\?next=%2Fwelcome%3Fplan%3Dpro/);
});
