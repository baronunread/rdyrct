import { expect, test, type Page } from "@playwright/test";
import { createAdditionalOrg } from "../orgs";
import { submitSignup } from "../resend";

// The worker here runs on .dev.vars.self-host: no email provider, no Polar,
// no Google sign-in. Each is a mode a fork meets on its first day, and the
// worker tests (no-email-signup, no-polar) only see the API side of it.

const password = "self-host-password-123";
const NOT_FOUND = "Nothing lives at this link.";

/** Signs up and lands on the dashboard: with no email provider there is no
 *  code to wait for, so the account is signed in straight away. */
async function signUp(page: Page, email: string) {
  await submitSignup(page, email, password);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByPlaceholder("https://example.com/launch").first()).toBeVisible({
    timeout: 30_000,
  });
}

test("sign-up lands signed in, with no code step", async ({ page }) => {
  await signUp(page, `selfhost-signup-${Date.now()}@example.com`);
  await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);
});

test("forgot password says this instance cannot send the reset", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`selfhost-forgot-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText("This instance has no email provider, so passwords cannot be reset by email."),
  ).toBeVisible();
  // It never claims a link went out.
  await expect(page.getByText("we sent a reset link")).toHaveCount(0);
});

test("without Polar there is nothing to buy and nothing capped", async ({ page }) => {
  await signUp(page, `selfhost-plan-${Date.now()}@example.com`);

  // The account reads as unlimited to the app, whatever plan its row holds.
  const me = await (await page.request.get("/api/user")).json();
  expect(me.user.plan).toBe("unlimited");

  // No Billing in the sidebar or the command menu.
  const nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Billing" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = page.getByPlaceholder("Search links, pages and actions");
  await palette.fill("billing");
  await expect(page.getByRole("option", { name: "Billing", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A free account owns one org and the sign-up made it. Here a second one
  // goes through, because no plan caps it.
  await createAdditionalOrg(page, "Second org");

  // The links page counts links without a ceiling, and no banner says this
  // account is over a plan.
  await page.goto("/links");
  await expect(page.getByText(/^0 links$/)).toBeVisible();
  await expect(page.getByText(/over (your|the) plan|over the limit|upgrade/i)).toHaveCount(0);

  // Nor does Members explain a seat limit there is not.
  await page.goto("/members");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite people" });
  await expect(invite.getByRole("button", { name: "Send invite" })).toBeVisible();
  await expect(invite.getByText(/free seats?/)).toHaveCount(0);

  // /billing is not a page here.
  const res = await page.goto("/billing");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
});

test("the platform admin is told nobody's address is verified", async ({ page }) => {
  // SUPERADMIN_EMAIL in .dev.vars.self-host.
  await signUp(page, "self-host-admin@example.com");
  await page.goto("/admin");
  await expect(
    page.getByText(
      "This instance has no email provider and no Google sign-in, so accounts are not verified",
    ),
  ).toBeVisible();
});
