import { expect, test } from "@playwright/test";

/**
 * The pricing page's plan finder (#261): typing or sliding a need past a
 * plan's limit moves the recommendation up, and the matching card says so.
 */
test("the plan finder moves the recommendation as needs cross a limit", async ({ page }) => {
  await page.goto("/pricing");
  await expect(
    page.getByRole("heading", { level: 1, name: /URL shortener pricing/i }),
  ).toBeVisible();

  const card = (plan: string) => page.locator(`[data-plan="${plan}"]`);
  const exact = (label: string) => page.getByLabel(`${label}, exact number`);

  // The starting needs (120 links and a domain) are Hobby.
  await expect(card("hobby")).toHaveAttribute("data-match", "true");
  await expect(page.getByText(/120 links is past the free plan's 30/)).toBeVisible();

  // Down to what the free plan covers.
  await exact("Links").fill("20");
  await exact("Custom domains").fill("0");
  await exact("Days of analytics history").fill("7");
  await expect(card("free")).toHaveAttribute("data-match", "true");
  await expect(card("hobby")).toHaveAttribute("data-match", "false");

  // One member past Hobby's 5 needs Pro.
  await exact("Team members").fill("6");
  await expect(card("pro")).toHaveAttribute("data-match", "true");

  // Past Pro, no card lights up.
  await exact("Links").fill("4000");
  await expect(page.getByText("More than Pro")).toBeVisible();
  await expect(page.locator('[data-match="true"]')).toHaveCount(0);

  // The slider drives the same number.
  await page.getByLabel("Days of analytics history", { exact: true }).fill("1000");
  await expect(exact("Days of analytics history")).toHaveValue("730");
});

test("a paid plan card leads to sign-up, then checkout", async ({ page }) => {
  await page.goto("/pricing");
  await expect(
    page.locator('[data-plan="hobby"]').getByRole("link", { name: "Start Hobby" }),
  ).toHaveAttribute("href", /\/signup\?next=%2Fbilling%3Fplan%3Dhobby/);
});

test("the team comparison names its sources and date", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: /team of five/i })).toBeVisible();
  await expect(page.getByText(/September 2026/)).toBeVisible();
});

// The HTML before any JavaScript runs is what a crawler, a link preview or an
// AI fetcher reads. It used to be the homepage's copy on every route, so the
// pricing page told them nothing about prices.
test("the pricing page's raw HTML carries its own copy, not the homepage's", async ({ page }) => {
  const html = await (await page.request.get("/pricing")).text();
  expect(html).toContain("<h1>rdyrct pricing</h1>");
  expect(html).not.toContain("show which channel earned the click");
});

// One primary button, on the plan the finder picked, so the cards and the
// finder never point at two different plans.
test("the primary button follows the plan the finder picks", async ({ page }) => {
  await page.goto("/pricing");
  const primary = page.locator("[data-plan] a.bg-accent");
  await expect(primary).toHaveCount(1);
  await expect(page.locator('[data-match="true"] a.bg-accent')).toHaveCount(1);
});
