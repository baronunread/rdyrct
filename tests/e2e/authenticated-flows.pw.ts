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
  await expect(page.getByText(hostname, { exact: true }).first()).toBeVisible();

  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await editor.getByPlaceholder("https://example.com/launch").fill("example.com/editor");
  await editor.getByPlaceholder("Spring launch").fill("Editor link");
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Editor link")).toBeVisible();

  await page.goto("/members");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite people" });
  const invitees = [`invitee-a-${Date.now()}@gmail.com`, `invitee-b-${Date.now()}@gmail.com`];
  await invite.getByLabel("Emails").fill(`${invitees[0]}, `);
  await invite.getByLabel("Emails").pressSequentially(invitees[1]);
  await expect(invite.getByRole("button", { name: `Remove ${invitees[0]}` })).toBeVisible();
  await invite.getByRole("button", { name: "Send 2 invites" }).click();
  await expect(page.getByText("2 invites sent")).toBeVisible();
  for (const address of invitees)
    await expect(page.locator("tbody tr").filter({ hasText: address })).toContainText(
      "Invite sent",
    );

  await page.goto("/settings");

  await page.getByLabel("Your name").fill("Playwright Person");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Name saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText(
    "Playwright Person",
  );
  // The menu trigger renders as a div with role=button, not a <button> tag.
  await expect(page.getByRole("button", { name: "Account menu" }).locator("img")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/,
  );
  const rootEl = page.locator("html");
  const themeBefore = await rootEl.getAttribute("data-theme");
  await page
    .getByRole("group", { name: "Theme" })
    .getByRole("button", { name: themeBefore === "dark" ? "Light" : "Dark" })
    .click();
  await expect(rootEl).not.toHaveAttribute("data-theme", themeBefore ?? "");

  await page.goto("/organization");
  await page.getByLabel("Organization name").fill("Playwright Org Renamed");
  await page
    .locator("form")
    .filter({ has: page.getByLabel("Organization name") })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByText("Organization renamed")).toBeVisible();

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

test("a signed-in visitor makes a real link from the hero, not an anonymous one", async ({
  page,
}) => {
  await signUpAndVerify(page, `hero-${Date.now()}@gmail.com`, "test-password-123");

  await page.goto("/");
  await expect(page.getByText(/Welcome back/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: /Dashboard/ }).first()).toBeVisible();

  await expect(page.getByLabel("Shorten a link, no account needed")).toHaveCount(0);
  await expect(page.getByText("Free plan forever")).toBeHidden();

  await expect(page.getByText(/clicks? this week/)).toBeVisible();
  await expect(page.getByLabel("Choose the organization for new links")).toHaveCount(0);
  const destination = page.getByLabel("Destination URL");
  await destination.fill("https://example.com/hero-quick-create");
  await page.getByRole("button", { name: "Shorten it" }).click();
  await expect(page.getByRole("link", { name: "Your short link" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Copy https?:\/\// })).toBeVisible();
  await expect(page.getByText(/^Saved to /)).toBeVisible();
  await expect(destination).toHaveValue("");

  await destination.fill("https://example.com/hero-quick-create");
  await page.getByRole("button", { name: "Shorten it" }).click();
  await expect(page.getByText("Already yours:")).toBeVisible();
});
