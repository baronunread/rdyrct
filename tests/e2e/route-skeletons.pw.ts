import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { makePlatformAdmin } from "./db";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

async function warmShell(page: Page, email: string) {
  // Let the shell persist its cache before the reload below. The regression
  // only exists when chrome paints from that cache while the page waits for a
  // fresh /user response.
  await page.goto("/dashboard");
  await expect(page.getByText(email)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

let sharedContext: BrowserContext;
let sharedPage: Page;
let sharedEmail: string;

test.beforeAll(async ({ browser }) => {
  sharedContext = await browser.newContext();
  sharedPage = await sharedContext.newPage();
  sharedEmail = `skeleton-${Date.now()}@gmail.com`;
  await signUpAndVerify(sharedPage, sharedEmail, password);
});

test.afterAll(async () => {
  await sharedContext.close();
});

/** Holds one API response open, which makes the route's first render observable. */
async function holdApi(page: Page, path: string) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      await held;
      await route.continue();
    },
  );
  return release;
}

async function expectFreshUserSkeleton(
  page: Page,
  path: string,
  skeleton: string,
  settled: Locator,
) {
  const release = await holdApi(page, "/api/user");
  await page.goto(path);
  await expect(page.getByTestId(skeleton)).toBeVisible();
  await expect(settled).toBeHidden();
  release();
  await expect(settled).toBeVisible();
}

test("a cold load uses the app-shell skeleton until the first user response", async () => {
  const page = sharedPage;
  await warmShell(page, sharedEmail);
  // Keep the authenticated session, but remove the cached chrome answer that
  // lets a returning browser render a route-specific skeleton instead.
  await page.evaluate(() => localStorage.clear());
  const release = await holdApi(page, "/api/user");
  await page.goto("/links");
  await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
  await expect(page.getByRole("button", { name: "New link" })).toBeHidden();
  release();
  await expect(page.getByRole("button", { name: "New link" }).first()).toBeVisible();
});

test("Links keeps its full route shape until the current user arrives", async () => {
  const page = sharedPage;
  await warmShell(page, sharedEmail);
  await expectFreshUserSkeleton(
    page,
    "/links",
    "links-page-skeleton",
    page.getByRole("button", { name: "New link" }).first(),
  );
});

test("sidebar navigation keeps the Links table usable after its data arrives", async () => {
  const page = sharedPage;
  await warmShell(page, sharedEmail);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => /^\/api\/orgs\/[^/]+\/links$/.test(url.pathname),
    async (route) => {
      await held;
      await route.continue();
    },
  );

  await page.getByRole("link", { name: "Links" }).click();
  await expect(page).toHaveURL(/\/links$/);
  await expect(page.getByTestId("links-table-skeleton")).toBeVisible();
  await expect(page.getByRole("button", { name: "New link" }).first()).toBeVisible();
  release();
  await expect(page.getByTestId("links-table-skeleton")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New link" }).first()).toBeVisible();
});

test("Members keeps invite controls out until the current user arrives", async () => {
  const page = sharedPage;
  await warmShell(page, sharedEmail);
  await expectFreshUserSkeleton(
    page,
    "/members",
    "members-page-skeleton",
    page.getByRole("button", { name: "Invite link" }),
  );
});

test("Billing waits for the fresh plan before showing upgrade controls", async () => {
  const page = sharedPage;
  await warmShell(page, sharedEmail);
  await expectFreshUserSkeleton(
    page,
    "/billing",
    "billing-page-skeleton",
    page.getByRole("button", { name: /Upgrade to Hobby/ }),
  );
});

test("Settings waits for fresh ownership before showing destructive controls", async () => {
  const page = sharedPage;
  await warmShell(page, sharedEmail);
  await expectFreshUserSkeleton(
    page,
    "/settings",
    "settings-page-skeleton",
    page.getByRole("button", { name: "Delete account" }),
  );
});

test("Domains keeps its paid upgrade path out until the current user arrives", async () => {
  const page = sharedPage;
  await warmShell(page, sharedEmail);
  await expectFreshUserSkeleton(
    page,
    "/domains",
    "domains-page-skeleton",
    page.getByRole("link", { name: "Upgrade to add a domain" }),
  );
});

test("Admin routes show their own skeletons while their data is delayed", async () => {
  const page = sharedPage;
  await warmShell(page, sharedEmail);
  await makePlatformAdmin(page, sharedEmail);

  // The cached shell still says this account is ordinary. Until the fresh
  // answer arrives, the route must not expose platform controls.
  await expectFreshUserSkeleton(
    page,
    "/admin",
    "admin-usage-skeleton",
    page.getByRole("navigation", { name: "Platform sections" }),
  );

  for (const route of [
    { path: "/admin", api: "/api/admin/usage", heading: "Platform usage" },
    { path: "/admin/links", api: "/api/admin/links", heading: "Links" },
    { path: "/admin/orgs", api: "/api/admin/orgs", heading: "Organizations" },
    { path: "/admin/users", api: "/api/admin/users", heading: "Users" },
    { path: "/admin/audit", api: "/api/admin/audit", heading: "Audit log" },
  ]) {
    const release = await holdApi(page, route.api);
    await page.goto(route.path);
    const skeleton =
      route.path === "/admin"
        ? "admin-usage-skeleton"
        : route.path === "/admin/audit"
          ? "admin-audit-rows-skeleton"
          : route.path === "/admin/links"
            ? "admin-links-rows-skeleton"
            : "admin-table-skeleton";
    await expect(page.getByTestId(skeleton)).toBeVisible();

    if (route.path === "/admin/audit") {
      // The header and search box are already real, so the row placeholder
      // must not duplicate either while the audit data is pending.
      await expect(page.getByRole("heading", { name: route.heading })).toHaveCount(1);
      await expect(page.getByRole("textbox", { name: "Search the audit log" })).toHaveCount(1);
    }

    release();
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  }
});
