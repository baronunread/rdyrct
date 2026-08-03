import { expect, type Page } from "@playwright/test";

/** Fills and submits the "create organization" form shown to a signed-in
 * user with no org yet. Waits for the switcher to pick it up as current
 * before returning: a caller that navigates immediately after can otherwise
 * abort the still-in-flight create request. */
export async function createOrg(page: Page, name: string) {
  await page.getByLabel("Organization name").fill(name);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTitle("Switch organization")).toHaveText(name);
}

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
