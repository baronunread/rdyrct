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
  ).toHaveAttribute("href", /\/signup\?next=%2Fwelcome%3Fplan%3Dhobby/);
});

// The HTML before any JavaScript runs is what a crawler, a link preview or an
// AI fetcher reads. It used to be the homepage's copy on every route, so the
// pricing page told them nothing about prices.
test("the pricing page's raw HTML carries its own copy, not the homepage's", async ({ page }) => {
  const html = await (await page.request.get("/pricing")).text();
  expect(html).toContain("<h1>rdyrct pricing</h1>");
  expect(html).not.toContain("The link shortener that answers to you.");
});

// One primary button, on the plan the finder picked, so the cards and the
// finder never point at two different plans.
test("the primary button follows the plan the finder picks", async ({ page }) => {
  await page.goto("/pricing");
  const primary = page.locator("[data-plan] a.bg-accent");
  await expect(primary).toHaveCount(1);
  await expect(page.locator('[data-match="true"] a.bg-accent')).toHaveCount(1);
});

// #387: each plan's monthly click count, and what happens past it.
test("the pricing page names each plan's click count, and says links keep redirecting", async ({
  page,
}) => {
  await page.goto("/pricing");
  for (const [plan, count] of [
    ["free", "5k"],
    ["hobby", "50k"],
    ["pro", "500k"],
  ]) {
    await expect(
      page.locator(`[data-plan="${plan}"]`).getByText(`${count} clicks counted a month`),
    ).toBeVisible();
  }
  await expect(page.getByText(/links keep redirecting every visitor/)).toBeVisible();

  // And the plan finder weighs it: past Hobby's 50k is Pro.
  await page.getByLabel("Clicks a month, exact number").fill("60000");
  await expect(page.locator('[data-plan="pro"]')).toHaveAttribute("data-match", "true");
});

/**
 * The landing's monthly/yearly pill sat off its button once the window
 * narrowed to a phone: it was measured once. It now measures again whenever
 * the buttons change size.
 */
test("the billing toggle's pill sits on the chosen button on a phone", async ({ page }) => {
  // Load wide, then narrow to a phone: the buttons grow to their 44px touch
  // height below sm, and a pill measured once stayed at the wide size.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Monthly" }).first().scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 390, height: 844 });
  const monthly = page.getByRole("button", { name: "Monthly" }).first();
  const yearly = page.getByRole("button", { name: /Yearly/ }).first();
  const pill = monthly.locator("xpath=../span");
  await monthly.scrollIntoViewIfNeeded();

  const matches = async (button: typeof monthly) => {
    await expect(async () => {
      const [a, b] = await Promise.all([pill.boundingBox(), button.boundingBox()]);
      expect(a && b).toBeTruthy();
      for (const k of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(a![k] - b![k])).toBeLessThanOrEqual(1);
      }
    }).toPass({ timeout: 5_000 });
  };
  await matches(monthly);
  await yearly.click();
  await matches(yearly);
});

/** Nothing on the public pages pushes a phone screen sideways. */
test("the landing, pricing and QR pages fit a 360px phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ["/", "/pricing", "/qr-code-generator", "/bitly-alternative", "/docs"]) {
    await page.goto(path);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, path).toBeLessThanOrEqual(360);
  }
});
