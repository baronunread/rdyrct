import { expect, test } from "@playwright/test";
import { visitLegalPages } from "./pages";

test("landing page keeps the main sign-up path", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page
    .getByRole("link", { name: /get started/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/signup/);
});

// The hero used to spend its second button sending the warmest visitor on the
// page to GitHub (#96). Both hero CTAs must now keep the visitor on the site,
// and the self-host link has to still exist, further down, under pricing.
test("the hero's second CTA stays on the site and self-hosting sits under pricing", async ({
  page,
}) => {
  await page.goto("/");

  const hero = page.locator("section").first();
  await expect(hero.getByRole("link", { name: /self-host/i })).toHaveCount(0);

  await hero.getByRole("link", { name: /see the analytics/i }).click();
  await expect(page).toHaveURL(/#analytics$/);
  await expect(page.locator("#analytics")).toBeInViewport();

  // Self-hosting keeps its own section after pricing, never a column inside it.
  // The star count is baked in at build time, so it has to render as a real
  // number: a failed build-time fetch falls back rather than emitting NaN.
  const selfHost = page.locator("#self-host");
  const pill = selfHost.getByRole("link", { name: /github/i });
  await expect(pill).toHaveAttribute("href", /github\.com/);
  await expect(pill).toContainText(/\d/);
  await expect(pill).not.toContainText(/NaN|undefined/);
});

// Self-hosted was the pricing table's first column, so the first thing a buyer
// read was a free unlimited version of what we were about to charge for.
test("the pricing table compares only the three paid-for plans", async ({ page }) => {
  await page.goto("/");

  const headers = page.locator("#pricing thead th");
  await expect(headers).toHaveCount(4); // blank corner, then Free, Hobby, Pro
  await expect(headers.nth(1)).toContainText("Free");
  await expect(headers.nth(2)).toContainText("Hobby");
  await expect(headers.nth(3)).toContainText("Pro");
  await expect(page.locator("#pricing thead")).not.toContainText(/self-hosted/i);
});

// Reading links sit on the page's centre line; doing links (theme, auth) stay
// right. The centre must not drift when "Sign up" becomes "Dashboard", which
// is what space-between used to do.
test("header centres the reading links and keeps the auth actions right", async ({ page }) => {
  await page.goto("/");

  const header = page.locator("header");
  const nav = header.locator("nav");
  await expect(nav.getByRole("link", { name: "Pricing" })).toBeVisible();

  const navBox = (await nav.boundingBox())!;
  const headBox = (await header.boundingBox())!;
  const navCentre = navBox.x + navBox.width / 2;
  const headCentre = headBox.x + headBox.width / 2;
  expect(Math.abs(navCentre - headCentre)).toBeLessThan(2);

  // Auth actions sit to the right of the centred nav, not among it.
  const signUp = (await header.getByRole("link", { name: "Sign up" }).boundingBox())!;
  expect(signUp.x).toBeGreaterThan(navBox.x + navBox.width);

  // On a phone the three columns do not fit, so the reading links drop out
  // and the page must not scroll sideways.
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(nav).toBeHidden();
  await expect(header.getByRole("link", { name: "Sign up" })).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
});

test("legal pages retain their baseline headings", async ({ page }) => {
  await visitLegalPages(page);
});

// A first-time visitor on a light operating system must land on light. The
// toggle then has to flip the page and survive a reload, which is the part
// that breaks if theme-init.js and lib/theme.ts disagree on the default.
test("landing page opens light and the toggle switches and sticks", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  const html = page.locator("html");

  await page.goto("/");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: /toggle theme/i }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await context.close();
});

// The stored choice wins over the operating system in both directions, so a
// dark-preferring visitor who picked light keeps light.
test("a dark operating system still opens dark by default", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await context.close();
});

test("the footer is the same width on every public page", async ({ page }) => {
  // The legal pages shared one container with their prose, so their footer
  // came out 720px against the landing page's 976: the rule above the links
  // visibly changed length when somebody followed a footer link, which is
  // the one journey that puts the two footers back to back.
  const widths: Record<string, number> = {};
  for (const path of ["/", "/privacy", "/terms"]) {
    await page.goto(path);
    const box = await page.locator("footer").boundingBox();
    widths[path] = Math.round(box?.width ?? 0);
  }

  expect(widths["/privacy"]).toBe(widths["/"]);
  expect(widths["/terms"]).toBe(widths["/"]);
  expect(widths["/"]).toBeGreaterThan(0);
});

test("the second screen argues with two messages, not two URLs (#96)", async ({ page }) => {
  await page.goto("/");
  // The point is made by showing the link where it is read. If this ever
  // becomes two URLs side by side again, it is back to asserting instead of
  // showing.
  await expect(page.getByText(/deciding whether to trust it/i)).toBeVisible();
  await expect(page.getByText("Deleted as spam")).toBeVisible();
  await expect(page.getByText("Obviously from Acme")).toBeVisible();
  await expect(page.getByRole("link", { name: /Put your domain on it/i })).toBeVisible();
});

test("a signed-out visitor still gets the anonymous shortener, not a dashboard card", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Try it without an account")).toBeVisible();
  await expect(page.getByText(/Welcome back/)).toHaveCount(0);
});
