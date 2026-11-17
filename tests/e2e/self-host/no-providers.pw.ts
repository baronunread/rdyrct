import { expect, test, type Page } from "@playwright/test";
import { createAdditionalOrg } from "../orgs";
import { submitSignup } from "../resend";

// Runs on .dev.vars.self-host: no email provider, no Polar, no Google. Worker tests only see the API side.

const password = "self-host-password-123";
const NOT_FOUND = "This page does not exist";

async function signUp(page: Page, email: string) {
  await submitSignup(page, email, password);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
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
  await page.getByRole("button", { name: "Forgot it?" }).click();
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText("This instance has no email provider, so passwords cannot be reset by email."),
  ).toBeVisible();
  await expect(page.getByText("we sent a reset link")).toHaveCount(0);
});

test("without Polar there is nothing to buy and nothing capped", async ({ page }) => {
  await signUp(page, `selfhost-plan-${Date.now()}@example.com`);

  const me = await (await page.request.get("/api/user")).json();
  expect(me.user.plan).toBe("unlimited");

  const nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Billing" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = page.getByPlaceholder("Search links, pages and actions");
  await palette.fill("billing");
  await expect(page.getByRole("option", { name: "Billing", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await createAdditionalOrg(page, "Second org");

  await page.goto("/links");
  await expect(page.getByText(/^0 short links$/)).toBeVisible();
  await expect(page.getByText(/over (your|the) plan|over the limit|upgrade/i)).toHaveCount(0);

  await page.goto("/members");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite people" });
  await expect(invite.getByRole("button", { name: "Send invite" })).toBeVisible();
  await expect(invite.getByText(/free seats?/)).toHaveCount(0);

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
