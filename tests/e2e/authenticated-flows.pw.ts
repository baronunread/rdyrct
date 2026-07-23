import { expect, test, type Page } from "@playwright/test";

const password = "test-password-123";
const explorerUrl = "http://localhost:5173/cdn-cgi/explorer/api";

function otpForEmail(value: unknown, email: string): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const otp = otpForEmail(item, email);
      if (otp) return otp;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const serialized = JSON.stringify(record);
  if (serialized.includes(email) && ("html" in record || "text" in record)) {
    return serialized.match(/\b\d{6}\b/)?.[0] ?? "";
  }
  for (const item of Object.values(record)) {
    const otp = otpForEmail(item, email);
    if (otp) return otp;
  }
  return "";
}

async function latestOtp(page: Page, email: string) {
  await expect
    .poll(async () => {
      const response = await page.request.get("http://localhost:4000/emails", {
        headers: { authorization: "Bearer test_token_admin" },
      });
      if (!response.ok()) return "";
      const body = await response.json();
      return otpForEmail(body, email);
    })
    .not.toBe("");

  const response = await page.request.get("http://localhost:4000/emails", {
    headers: { authorization: "Bearer test_token_admin" },
  });
  return otpForEmail(await response.json(), email);
}

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

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  const otp = await latestOtp(page, email);
  await page.locator("input").first().focus();
  await page.keyboard.insertText(otp);

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByLabel("Organization name").fill("Playwright Org");
  await page.getByRole("button", { name: "Create organization" }).click();

  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await expect(destination).toBeVisible();
  await destination.fill("example.com/playwright");
  await page.getByRole("button", { name: "Create link" }).click();

  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("http://localhost:5173/");

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
