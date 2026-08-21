import { expect, type Locator, type Page } from "@playwright/test";

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

/**
 * The element's box, waited for rather than snatched.
 *
 * `locator.boundingBox()` returns null on an element that is attached,
 * `visibility: visible` and reporting a real `getBoundingClientRect` a
 * millisecond later. It is a race inside the measurement, not a page that is
 * not ready: throttle the CPU 8x and the header on the landing page hands
 * back null on the first call and a correct box on the second, with no view
 * transition and no re-render in between.
 *
 * Every layout assertion in this suite used to write `(await
 * el.boundingBox())!`, so on a slow CI runner one of them died on
 * "Cannot read properties of null" while the page under it was perfectly
 * correct. Polling is not a padded timeout: the box is already there, this
 * just asks again for the answer the DOM already has.
 */
export async function boxOf(
  locator: Locator,
): Promise<NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>> {
  await expect.poll(async () => (await locator.boundingBox()) !== null).toBe(true);
  const box = await locator.boundingBox();
  if (!box) throw new Error("boundingBox went null again straight after polling non-null");
  return box;
}
