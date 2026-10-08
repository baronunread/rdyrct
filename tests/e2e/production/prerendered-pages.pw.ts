import { expect, test, type Page } from "@playwright/test";

const PRERENDERED_PAGES = [
  { path: "/", heading: "Short links and QR codes that show which channel earned the click." },
  { path: "/pricing", heading: "URL shortener pricing: free, $4 or $9 a month" },
  { path: "/qr-code-generator", heading: "Free QR code generator with logo" },
  { path: "/docs", heading: "Developer docs" },
  { path: "/roadmap", heading: "What we are building" },
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/terms", heading: "Terms of Service" },
  { path: "/login", heading: "Sign in" },
  { path: "/signup", heading: "Create an account" },
] as const;

const HTML_FALLBACK_PAGES = [] as const;

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
  // The Google button is in the prerendered form, disabled until /config says
  // it works, so nothing pops in when /config arrives.
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /Continue with Google/i }), path).toBeDisabled();
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

// The A/B test must not flash the wrong hero. The inline script in index.html
// picks the stored arm before first paint, so the test arm is on screen with
// the bundles blocked, and hydration leaves the same one element behind.
test("a visitor given the test hero never sees the control hero first", async ({ browser }) => {
  const consent = {
    "rdyrct:consent:v2": "accepted",
    "rdyrct:consent:v2:at": String(Date.now()),
    "rdyrct:hero-variant:v1": "test",
  };
  const testHeading = "Shorten a link. See who clicks it.";
  const controlHeading = "Short links and QR codes that show which channel earned the click.";
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: new URL(test.info().project.use.baseURL ?? "").origin,
        localStorage: Object.entries(consent).map(([name, value]) => ({ name, value })),
      },
    ],
  };

  // Only the bundles are blocked: the inline script still runs, as it does
  // in the gap before the bundle has loaded and hydrated.
  const unhydrated = await browser.newContext({ storageState });
  const before = await unhydrated.newPage();
  await blockScripts(before);
  await before.goto("/");
  await expect(before.getByRole("heading", { level: 1 })).toHaveText(testHeading);
  await unhydrated.close();

  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  // Reports any painted frame in which the control heading is on screen.
  // Hydration and the session resolving must not flip this visitor
  // test -> control -> test. Frames only: before the stylesheet loads, a
  // layout read would see both arms.
  // A slow session is what opens the window: the arm is not assigned until
  // it resolves.
  await page.route("**/api/user", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  const sightings: string[] = [];
  page.on("console", (message) => {
    if (message.text() === "control-hero-visible") sightings.push(message.text());
  });
  await page.addInitScript((heading) => {
    requestAnimationFrame(function tick() {
      const visible = [...document.querySelectorAll("h1")].some(
        (h1) => h1.textContent === heading && h1.getBoundingClientRect().height > 0,
      );
      if (visible) console.info("control-hero-visible");
      requestAnimationFrame(tick);
    });
  }, controlHeading);
  await page.goto("/");
  await expect(page.locator("[data-hero-arm]:not([data-ssr])")).toHaveCount(1);
  await page.waitForTimeout(2000);
  expect(sightings).toEqual([]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(testHeading);
  await expect(page.getByText(controlHeading)).toHaveCount(0);
  await context.close();
});

// The auth pages read the URL and the session while rendering. Arriving with
// query params must hydrate onto the plain prerendered form without a
// mismatch, and leave a form that still takes input.
test("the auth pages hydrate with query params and stay usable", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|didn't match|server html/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });

  await page.goto("/signup?next=/billing%3Fplan%3Dpro");
  await expect(page.getByRole("heading", { level: 1, name: "Create an account" })).toBeVisible();
  await page.getByLabel("Email").fill("someone@example.com");
  await expect(page.getByLabel("Email")).toHaveValue("someone@example.com");

  await page.goto("/login?next=/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("someone@example.com");
  await expect(page.getByLabel("Email")).toHaveValue("someone@example.com");
  expect(hydrationErrors).toEqual([]);
});
