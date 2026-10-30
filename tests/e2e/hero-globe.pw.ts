import { expect, test } from "@playwright/test";

// The landing hero's globe is decoration over prerendered copy. These hold two
// of the promises that make it safe in front of a slow phone: it moves nothing
// when it arrives, and it keeps still for a visitor who asked for less motion.
// The third, that it is not in the prerendered HTML, needs a production build:
// production/prerendered-pages.pw.ts checks it.

const HEADING = "The link shortener that answers to you.";

test("the globe arrives hidden from assistive tech and shifts nothing", async ({ page }) => {
  // Hold the globe's chunk so the page can be measured before and after it.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/hero-globe/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/");

  const hero = page.locator("[data-hero]");
  await expect(hero.getByRole("heading", { level: 1, name: HEADING })).toBeVisible();
  const before = await hero.boundingBox();

  release();
  // cobe draws the sphere in WebGL; the clicks are a 2D canvas over it.
  const canvas = hero.locator("[data-globe-overlay]");
  await expect(canvas).toBeVisible();
  await expect(hero.locator("[aria-hidden=true]:has([data-globe-overlay])")).toHaveCount(1);
  await expect(hero.locator("canvas")).toHaveCount(2);
  expect((await canvas.boundingBox())?.height).toBeGreaterThan(200);
  expect(await hero.boundingBox()).toEqual(before);
});

test("the globe turns, unless the visitor asked for less motion", async ({ page }) => {
  const canvas = page.locator("[data-hero] [data-globe-overlay]");
  const frame = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const firstFrame = async () => {
    // The page first: on a dev server that has just started, the landing
    // compiles on this request, and the globe can only come after it.
    await expect(page.getByRole("heading", { level: 1, name: HEADING })).toBeVisible({
      timeout: 20_000,
    });
    await expect(canvas).toBeVisible();
    // Visible is not drawn: a frame read before the first draw is blank, and
    // a blank baseline would let "it turns" pass on that first draw alone.
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) => {
          const blank = document.createElement("canvas");
          blank.width = c.width;
          blank.height = c.height;
          return c.toDataURL() !== blank.toDataURL();
        }),
      )
      .toBe(true);
    return frame();
  };

  await page.goto("/");
  const turning = await firstFrame();
  await expect.poll(frame).not.toBe(turning);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const still = await firstFrame();
  // Standing still has no moment to wait for: the globe is watched for as
  // long as a turning one takes to move.
  await page.waitForTimeout(600);
  expect(await frame()).toBe(still);
});
