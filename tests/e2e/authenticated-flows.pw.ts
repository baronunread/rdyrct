import { expect, test } from "@playwright/test";
import { appUrl } from "./environment";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { addCustomDomain, createOrg } from "./orgs";

const password = "test-password-123";

test("a new owner can create an organization and a scheme-less quick link", async ({ page }) => {
  const email = `playwright-${Date.now()}@gmail.com`;

  await signUpAndVerify(page, email, password);
  await createOrg(page, "Playwright Org");

  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await expect(destination).toBeVisible();
  await destination.fill("example.com/playwright");
  await page.getByRole("button", { name: "Create link" }).click();

  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(`${appUrl}/`);

  await setPlan(page, email);
  const hostname = await addCustomDomain(page, `links-${Date.now()}.example.com`);
  await expect(page.getByText(hostname, { exact: true })).toBeVisible();

  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await editor.getByPlaceholder("https://example.com/launch").fill("example.com/editor");
  await editor.getByPlaceholder("Spring launch").fill("Editor link");
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Editor link")).toBeVisible();

  await page.goto("/members");
  await page.getByPlaceholder("teammate@company.com").fill(`invitee-${Date.now()}@gmail.com`);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent")).toBeVisible();

  await page.goto("/settings");
  const organizationName = page.getByLabel("Organization name");
  await organizationName.fill("Playwright Org Renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Organization renamed")).toBeVisible();

  const signOutUrl = "**/api/auth/sign-out";
  await page.route(signOutUrl, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Sign-out service unavailable" }),
    });
  });
  await page.getByLabel("Sign out").click();
  await expect(page.getByText("Sign-out service unavailable")).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);

  await page.unroute(signOutUrl);
  await page.getByLabel("Sign out").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

/**
 * The hero for somebody who already has an account (#96). Offering them a
 * link that expires in 24 hours, and then offering to "keep" it by signing
 * up for the account they are signed into, reads as nobody having tried it.
 */
test("a signed-in visitor sees their own numbers, not the anonymous shortener", async ({
  page,
}) => {
  await signUpAndVerify(page, `hero-${Date.now()}@gmail.com`, "test-password-123");
  await createOrg(page, "Hero Org");

  await page.goto("/");
  await expect(page.getByText(/Welcome back/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: /Open dashboard/i }).first()).toBeVisible();

  // The anonymous form is gone, and so is the pitch aimed at strangers.
  await expect(page.getByLabel("Try it without an account")).toHaveCount(0);
  await expect(page.getByText("Free plan forever")).toBeHidden();
});
