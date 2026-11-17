import { expect, type Page } from "@playwright/test";

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

const LEGAL_PAGES = [
  { path: "/privacy", heading: "Privacy policy" },
  { path: "/terms", heading: "Terms of service" },
];

/**
 * Asserting on the heading is what makes both suites meaningful: a blocked
 * bundle still answers 200 with the prerendered shell. `afterEach` runs while
 * the page is still open.
 */
export async function visitLegalPages(
  page: Page,
  afterEach?: (path: string) => Promise<void>,
): Promise<void> {
  for (const { path, heading } of LEGAL_PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await afterEach?.(path);
  }
}
