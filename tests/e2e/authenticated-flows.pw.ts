import { expect, test, type Page } from "@playwright/test";
import { appUrl, explorerUrl } from "./environment";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

async function setPlan(page: Page, email: string) {
  const databases = await page.request.get(`${explorerUrl}/d1/database`);
  expect(databases.ok()).toBe(true);
  const body = await databases.json();
  const databaseId = body.result.find((database: { name: string }) => database.name === "DB")?.uuid;
  expect(databaseId).toBeTruthy();

  const response = await page.request.post(`${explorerUrl}/d1/database/${databaseId}/raw`, {
    data: {
      sql: "UPDATE user SET plan = ? WHERE email = ?",
      params: ["hobby", email],
    },
  });
  expect(response.ok()).toBe(true);
}

test("a new owner can create an organization and a scheme-less quick link", async ({ page }) => {
  const email = `playwright-${Date.now()}@gmail.com`;

  await signUpAndVerify(page, email, password);
  await page.getByLabel("Organization name").fill("Playwright Org");
  await page.getByRole("button", { name: "Create organization" }).click();

  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await expect(destination).toBeVisible();
  await destination.fill("example.com/playwright");
  await page.getByRole("button", { name: "Create link" }).click();

  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(`${appUrl}/`);

  await setPlan(page, email);
  await page.goto("/domains");
  const hostname = `links-${Date.now()}.example.com`;
  await page.getByPlaceholder("links.example.com").fill(hostname);
  await page.getByRole("button", { name: "Add domain" }).click();
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
