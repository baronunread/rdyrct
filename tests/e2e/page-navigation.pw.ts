import { expect, test, type Page } from "@playwright/test";
import { createQuickLink } from "./orgs";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

declare global {
  interface Window {
    /** Set by watchForSkeletons below. */
    __skeletonSeen?: boolean;
  }
}

/**
 * Watches the sheet from inside the page for any skeleton, however briefly
 * it is there. A Playwright assertion polls, and a skeleton that lives for
 * two frames slips between polls; a MutationObserver sees every one.
 */
async function watchForSkeletons(page: Page) {
  await page.evaluate(() => {
    const sheet = document.querySelector("[data-app-sheet]");
    if (!sheet) throw new Error("no app sheet on screen");
    window.__skeletonSeen = false;
    const seen = () => !!sheet.querySelector(".animate-pulse, [data-testid$='-skeleton']");
    new MutationObserver(() => {
      if (seen()) window.__skeletonSeen = true;
    }).observe(sheet, { childList: true, subtree: true });
  });
}

const skeletonSeen = (page: Page) => page.evaluate(() => window.__skeletonSeen);

test("a page opened from the sidebar after a hover arrives whole, with no skeleton", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndVerify(page, `page-nav-${Date.now()}@gmail.com`, password);
  // A link, so Links and Analytics have a table and numbers to draw.
  await createQuickLink(page, "example.com/page-nav");
  await page.keyboard.press("Escape");
  const sidebar = page.locator("aside").first();

  for (const { link, heading } of [
    { link: "Links", heading: "Links" },
    { link: "Analytics", heading: "Analytics" },
    { link: "Members", heading: "Members" },
    { link: "Billing", heading: "Billing" },
  ]) {
    await watchForSkeletons(page);
    const target = sidebar.getByRole("link", { name: link, exact: true });
    // The hover fetches the page's chunk and data (defaultPreload: "intent").
    await target.hover();
    await page.waitForLoadState("networkidle");
    await target.click();
    await expect(
      page.locator("[data-app-sheet]").getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
    expect(await skeletonSeen(page), `a skeleton showed on the way to ${link}`).toBe(false);
  }
});
