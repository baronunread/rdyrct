import { expect, type Page } from "@playwright/test";

/**
 * Visit both legal pages and confirm each one actually rendered.
 *
 * Shared because two suites need the same walk for different reasons: the dev
 * suite checks the headings survive, the production suite checks the route
 * raises no Content-Security-Policy violation. Asserting on the heading is
 * what makes either meaningful — a blocked bundle still answers 200 with the
 * pre-render shell.
 */
export async function visitLegalPages(page: Page): Promise<void> {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();

  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
}
