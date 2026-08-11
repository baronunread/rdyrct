import { expect, type Page } from "@playwright/test";

/** Opens the org switcher and creates another org under the same signed-in
 * account, for tests that share one user (see link-addresses.pw.ts) and so
 * have already left the no-org state behind by the time they need this.
 * Waits for the switch to settle, for the same reason as createOrg above. */
export async function createAdditionalOrg(page: Page, name: string) {
  await page.getByTitle("Switch organization").click();
  await page.getByRole("menuitem", { name: "New organization" }).click();
  const dialog = page.getByRole("dialog", { name: "New organization" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTitle("Switch organization")).toHaveText(name);
}

/** Adds a custom domain from the Domains page and returns its hostname.
 * Does not wait for activation: callers that need "active" (DNS+TLS have
 * resolved against the fake Cloudflare backend) poll for that themselves,
 * since how long they're willing to wait varies by test. */
export async function addCustomDomain(page: Page, hostname = `e2e-${Date.now()}.example.com`) {
  await page.goto("/domains");
  await page.getByPlaceholder("links.example.com").fill(hostname);
  await page.getByRole("button", { name: "Add domain" }).click();
  return hostname;
}

/** Adds a custom domain and waits for it to serve, for the tests that need a
 * working custom address rather than the act of adding one. The playwright
 * env reports DNS and TLS ready immediately (CF_DEV_ENV "instant"), so this
 * waits on one probe-ramp sleep plus a domains poll, not on the staged delays
 * local dev uses. Callers should mark themselves `test.slow()`: this alone can
 * take most of the default budget. */
export async function addActiveCustomDomain(page: Page, hostname?: string) {
  const added = await addCustomDomain(page, hostname);
  await expect(page.getByText("active", { exact: true })).toBeVisible({ timeout: 30_000 });
  return added;
}

/** Opens the Links page's "New link" dialog and returns it. */
export async function openNewLinkDialog(page: Page) {
  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  return page.getByRole("dialog", { name: "New link" });
}
