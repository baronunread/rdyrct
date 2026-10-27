import { expect, test } from "@playwright/test";
import { sharedLinkHost } from "./environment";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { addCustomDomain, createQuickLink } from "./orgs";
import { signOut } from "./pages";

const password = "test-password-123";

test("a new owner can create an organization and a scheme-less quick link", async ({ page }) => {
  const email = `playwright-${Date.now()}@gmail.com`;

  await signUpAndVerify(page, email, password);

  await createQuickLink(page, "example.com/playwright");
  await expect(page.getByRole("dialog")).toContainText(`${sharedLinkHost}/`);

  await setPlan(page, email);
  const hostname = await addCustomDomain(page, `links-${Date.now()}.example.com`);
  // The row names the host first; its DNS records repeat it below.
  await expect(page.getByText(hostname, { exact: true }).first()).toBeVisible();

  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await editor.getByPlaceholder("https://example.com/launch").fill("example.com/editor");
  await editor.getByPlaceholder("Spring launch").fill("Editor link");
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Editor link")).toBeVisible();

  await page.goto("/members");
  await page.getByRole("button", { name: "Invite people" }).click();
  const invite = page.getByRole("dialog", { name: "Invite people" });
  await invite.getByPlaceholder("teammate@company.com").fill(`invitee-${Date.now()}@gmail.com`);
  await invite.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent")).toBeVisible();

  await page.goto("/settings");

  // Account settings: change your own display name and flip the theme.
  await page.getByLabel("Your name").fill("Playwright Person");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Name saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText(
    "Playwright Person",
  );
  // No uploaded image, so the footer shows a blobatar (inline SVG data URI).
  // The menu trigger renders as a div with role=button, not a <button> tag.
  await expect(page.getByRole("button", { name: "Account menu" }).locator("img")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/,
  );
  const rootEl = page.locator("html");
  const themeBefore = await rootEl.getAttribute("data-theme");
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(rootEl).not.toHaveAttribute("data-theme", themeBefore ?? "");

  // Organization settings live on their own page now.
  await page.goto("/organization");
  await page.getByLabel("Organization name").fill("Playwright Org Renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Organization renamed")).toBeVisible();

  // The theme item in the account menu toggles without closing the menu.
  const beforeMenuTheme = await rootEl.getAttribute("data-theme");
  await page.getByRole("button", { name: "Account menu" }).click();
  const themeItem = page.getByRole("menuitem", { name: /theme$/ });
  await themeItem.click();
  await expect(rootEl).not.toHaveAttribute("data-theme", beforeMenuTheme ?? "");
  await expect(themeItem).toBeVisible();
  await page.keyboard.press("Escape");

  const signOutUrl = "**/api/auth/sign-out";
  await page.route(signOutUrl, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Sign-out service unavailable" }),
    });
  });
  await signOut(page);
  await expect(page.getByText("Sign-out service unavailable")).toBeVisible();
  await expect(page).toHaveURL(/\/organization$/);

  await page.unroute(signOutUrl);
  await signOut(page);
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
test("a signed-in visitor makes a real link from the hero, not an anonymous one", async ({
  page,
}) => {
  await signUpAndVerify(page, `hero-${Date.now()}@gmail.com`, "test-password-123");

  await page.goto("/");
  await expect(page.getByText(/Welcome back/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: /Dashboard/ }).first()).toBeVisible();

  // The anonymous form is gone, and so is the pitch aimed at strangers.
  await expect(page.getByLabel("Shorten a link, no account needed")).toHaveCount(0);
  await expect(page.getByText("Free plan forever")).toBeHidden();

  // The card is a quick create in their own organization: the link it makes
  // is theirs, kept, and the same destination again gives that link back.
  // It says which organization that is, so the link never lands somewhere
  // unexpected; with only one there is nothing to pick.
  await expect(page.getByText(/clicks? this week/)).toBeVisible();
  await expect(page.getByLabel("Choose the organization for new links")).toHaveCount(0);
  const destination = page.getByLabel("Destination URL");
  await destination.fill("https://example.com/hero-quick-create");
  await page.getByRole("button", { name: "Shorten it" }).click();
  // The same panel the anonymous card opens: the link to copy, its QR, and
  // a footer that says this one is kept.
  await expect(page.getByRole("link", { name: "Your short link" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Copy https?:\/\// })).toBeVisible();
  await expect(page.getByText(/kept for good/)).toBeVisible();
  await expect(destination).toHaveValue("");

  await destination.fill("https://example.com/hero-quick-create");
  await page.getByRole("button", { name: "Shorten it" }).click();
  await expect(page.getByText("Already yours:")).toBeVisible();
});
