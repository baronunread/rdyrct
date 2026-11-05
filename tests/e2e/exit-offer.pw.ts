import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";

/**
 * The exit offer (lib/exit-offer.ts): a signed-out desktop visitor who has
 * been on a marketing page ten seconds and moves the pointer out through the
 * top gets a card showing the Polar discount code (EXIT_OFFER_CODE, set for
 * this run in wrangler.jsonc's playwright env, served by /api/config), with
 * Copy, "See plans" and "No thanks". It never asks for an email address. A
 * phone and a signed-in visitor never see the card.
 *
 * The page clock is installed so the ten seconds pass at once, then resumed
 * so the card runs in real time.
 */

const CODE = "PLAYWRIGHT20";

const card = (page: Page) => page.getByRole("dialog", { name: /Leaving already/ });

/** A desktop window on `path`, with a clock the test can move. */
async function openOnDesktop(page: Page, path: string) {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** The pointer goes up and out past the top edge. The browser then reports a
 * mouseout with no element to go to; sent by hand, because the pointer
 * cannot leave a headless viewport. */
async function pointerOutOfTop(page: Page) {
  await page.mouse.move(640, 200);
  await page.mouse.move(640, 5, { steps: 4 });
  await page.evaluate(() =>
    document.documentElement.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, clientX: 640, clientY: -1, relatedTarget: null }),
    ),
  );
}

/** Ten seconds on the page, then out through the top of the window. */
async function leaveThroughTop(page: Page) {
  await page.clock.fastForward(11_000);
  await pointerOutOfTop(page);
}

/** On `path`, ten seconds on, out through the top: the card is up, and
 * the clock runs in real time again for what the test does with it. */
async function openCard(page: Page, path = "/") {
  await openOnDesktop(page, path);
  await leaveThroughTop(page);
  await expect(card(page)).toBeVisible();
  await page.clock.resume();
}

/** The visitor's answer is stored: the card never shows here again. Checked
 * instead of the card's fade, which the page clock may hold still. */
async function expectAnswered(page: Page) {
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("rdyrct:exit-offer:v1")))
    .toContain('"final":true');
}

/** A fresh page load, ten seconds on, out through the top: no card. */
async function expectNoCardAfterReload(page: Page) {
  await page.clock.install();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoCard(page);
}

/** Leaves the page as above and checks no card came up. */
async function expectNoCard(page: Page) {
  await leaveThroughTop(page);
  await expect(card(page)).toHaveCount(0);
}

test("a leaving visitor sees the code and can copy it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openOnDesktop(page, "/");

  // Not in the first ten seconds.
  await pointerOutOfTop(page);
  await expect(card(page)).toHaveCount(0);

  await leaveThroughTop(page);
  await expect(card(page)).toBeVisible();
  await page.clock.resume();
  await expect(card(page)).toContainText("first 3 months of Hobby or Pro");
  await expect(card(page)).toContainText(CODE);

  await card(page).getByRole("button", { name: "Copy" }).click();
  await expect(card(page).getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
  await expectAnswered(page);
});

test("See plans opens the pricing page", async ({ page }) => {
  await openCard(page);
  await card(page).getByRole("link", { name: "See plans" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expectAnswered(page);

  // Taken: the card never comes back in this browser.
  await expectNoCardAfterReload(page);
});

test("the card asks for no email address", async ({ page }) => {
  await openCard(page);
  await expect(card(page).getByRole("textbox")).toHaveCount(0);
  await expect(card(page)).not.toContainText(/email/i);
  await expect(card(page).getByRole("button", { name: "No thanks" })).toBeVisible();
});

test("No thanks puts it away for good", async ({ page }) => {
  await openOnDesktop(page, "/pricing");
  await leaveThroughTop(page);
  await card(page).getByRole("button", { name: "No thanks" }).click();
  await expectAnswered(page);

  // Even past the 30 days a dismissal would wait.
  await page.evaluate(() => {
    const raw = localStorage.getItem("rdyrct:exit-offer:v1") ?? "{}";
    const memory: { shownAt: number; final: boolean } = JSON.parse(raw);
    localStorage.setItem("rdyrct:exit-offer:v1", JSON.stringify({ ...memory, shownAt: 0 }));
  });
  await page.reload();
  await expectNoCard(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("never shows", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoCard(page);
  });
});

test("never shows to a signed-in visitor", async ({ page }) => {
  await signUpAndVerify(page, `exit-offer-in-${Date.now()}@gmail.com`, "test-password-123");
  await openOnDesktop(page, "/");
  await expectNoCard(page);
});
