import { expect, test, type Page } from "@playwright/test";

const PRERENDERED_PAGES = [
  { path: "/", heading: "Short links and QR codes that show which channel earned the click." },
  { path: "/pricing", heading: "URL shortener pricing: free, $4 or $9 a month" },
  { path: "/qr-code-generator", heading: "Free QR code generator with logo" },
  { path: "/docs", heading: "Developer docs" },
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/terms", heading: "Terms of Service" },
] as const;

const HTML_FALLBACK_PAGES = [
  { path: "/roadmap", text: "URL shortener roadmap - what rdyrct is building next" },
  { path: "/signup", text: "Sign up - rdyrct URL shortener and QR codes" },
  { path: "/login", text: "Log in - rdyrct" },
] as const;

async function blockScripts(page: Page) {
  await page.route("**/*", (route) =>
    route.request().resourceType() === "script" ? route.abort() : route.continue(),
  );
}

async function assertPrerenderedHeadings(page: Page) {
  for (const { path, heading } of PRERENDERED_PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
  }
}

test("public content stays visible and correct before JavaScript runs", async ({ page }) => {
  await blockScripts(page);
  await assertPrerenderedHeadings(page);
  for (const { path, text } of HTML_FALLBACK_PAGES) {
    await page.goto(path);
    await expect(page.locator("#root")).toContainText(text);
  }
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();
  await expect(page.locator("#faq")).toHaveCSS("opacity", "1");
  await page.goto("/docs");
  const origin = new URL(page.url()).origin;
  await expect(page.locator('code[data-mcp-url="endpoint"]')).toHaveText(`${origin}/api/mcp`);
});

test("all prerendered pages hydrate without mismatch warnings", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|didn't match|server html/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });

  await assertPrerenderedHeadings(page);

  const origin = new URL(page.url()).origin;
  await page.goto("/docs");
  await expect(page.getByText(`${origin}/api/mcp`, { exact: true })).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("conditional requests keep the prerendered HTML representation", async ({ request }) => {
  const first = await request.get("/pricing");
  expect(first.status()).toBe(200);
  const etag = first.headers().etag;
  expect(etag).toBeTruthy();

  const head = await request.head("/pricing");
  expect(head.status()).toBe(200);
  expect(head.headers().etag).toBe(etag);
  expect(head.headers()["content-type"]).toContain("text/html");

  const second = await request.get("/pricing", { headers: { "if-none-match": etag! } });
  if (second.status() === 304) {
    expect(second.headers()["content-type"]).toContain("text/html");
  } else {
    expect(second.status()).toBe(200);
    const body = await second.text();
    expect(body).toContain("URL shortener pricing: free, $4 or $9 a month");
    expect(body).not.toContain(
      "Short links and QR codes that show which channel earned the click.",
    );
  }
});
