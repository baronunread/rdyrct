import { expect, type Page } from "@playwright/test";

const LEGAL_PAGES = [
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/terms", heading: "Terms of Service" },
];

/**
 * Visit both legal pages and confirm each one actually rendered.
 *
 * Shared because two suites need the same walk for different reasons: the dev
 * suite checks the headings survive, the production suite checks the route
 * raises no Content-Security-Policy violation. Asserting on the heading is
 * what makes either meaningful. A blocked bundle still answers 200 with the
 * pre-render shell.
 *
 * `afterEach` runs while that page is still open, for checks that read state
 * the next navigation would throw away.
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
