import { expect, test, type Page } from "@playwright/test";

/**
 * The prerendered app shell (scripts/prerender-app-shell.tsx): a reload of an
 * app page paints the sidebar and the page's skeleton from the HTML alone.
 * The app's scripts are blocked in every case, so what shows is what the
 * Worker sent, before any JavaScript could have drawn it.
 */

const CACHED_USER = {
  user: { id: "u1", name: "Wanda Weiss", email: "wanda@example.test", image: null },
  orgs: [{ id: "o1", name: "Juniper Group", role: "owner", plan: "pro", locked: false }],
};

async function reloadWithoutScripts(
  page: Page,
  path: string,
  storage: Record<string, string>,
): Promise<void> {
  // Storage is written at document start of the reload itself, before the
  // head script reads it. Writing it from a page the app is running on
  // raced that app: its /user answer (signed out) cleared the cache again.
  await page.addInitScript((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, storage);
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.goto(path);
}

const signedIn = {
  "rdyrct:user:v2": JSON.stringify(CACHED_USER),
  "rdyrct:currentOrg": "o1",
};

test("a signed-in reload paints the sidebar from the HTML, with the cached org and person", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await reloadWithoutScripts(page, "/links", signedIn);

  const sidebar = page.locator('[data-shell-width="open"] aside');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Links", { exact: true })).toBeVisible();
  // The slots the head script fills from the cache.
  const orgName = await sidebar
    .locator('[data-shell-slot="org-name"]')
    .evaluate((el) => getComputedStyle(el, "::after").content);
  expect(orgName).toBe('"Juniper Group"');
  const person = await sidebar
    .locator('[data-shell-slot="user-name"]')
    .evaluate((el) => getComputedStyle(el, "::after").content);
  expect(person).toBe('"Wanda Weiss"');
});

test("a folded sidebar reloads folded", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await reloadWithoutScripts(page, "/dashboard", { ...signedIn, sidebar: "collapsed" });
  await expect(page.locator('[data-shell-width="folded"] aside')).toBeVisible();
  await expect(page.locator('[data-shell-width="open"] aside')).toBeHidden();
});

test("a signed-out visitor never sees the shell on the way to the login page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await reloadWithoutScripts(page, "/dashboard", {});
  await expect(page.locator("[data-shell-static]")).toBeHidden();
  await expect(page.getByText("Dashboard", { exact: true }).filter({ visible: true })).toHaveCount(
    0,
  );
});
