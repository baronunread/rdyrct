import { expect, test, type Page } from "@playwright/test";

const CACHED_USER = {
  user: { id: "u1", name: "Wanda Weiss", email: "wanda@example.test", image: null },
  orgs: [{ id: "o1", name: "Juniper Group", role: "owner", plan: "pro", locked: false }],
};

async function reloadWithoutScripts(
  page: Page,
  path: string,
  storage: Record<string, string>,
): Promise<void> {
  // Written at document start of the reload, before the head script reads it:
  // writing from a running app raced its signed-out /user answer clearing it.
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
