import { expect, test, type Page } from "@playwright/test";

// The landing below the hero: a section for each thing you get, and each
// detail in a card of its own with a short loop of the product doing it.

const section = (page: Page, name: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name }) });

test("each detail is a card that says what it is, and its loop shows it", async ({ page }) => {
  await page.goto("/");
  const links = section(page, "Branded short links.");
  await links.scrollIntoViewIfNeeded();

  for (const title of ["Your own domain", "Words you choose", "Campaign tags"]) {
    await expect(links.getByRole("heading", { level: 3, name: title })).toBeVisible();
  }
  // The loop repeats the words, so assistive tech gets the words alone.
  const scenes = links.locator("[data-scene]");
  await expect(scenes).toHaveCount(3);
  for (const scene of await scenes.all())
    await expect(scene).toHaveAttribute("aria-hidden", "true");
  await expect(scenes.nth(2)).toContainText("spring-sale");
});

test("the QR section draws a real code and leads to the generator", async ({ page }) => {
  await page.goto("/");
  const qr = section(page, "Print once. Change it later.");
  await qr.scrollIntoViewIfNeeded();
  // The code is the app's own QR component, loaded once the card is near.
  await expect(qr.locator("[data-scene]").first().locator("svg, canvas").first()).toBeVisible();

  await page.getByRole("link", { name: "Make a QR code" }).click();
  await expect(page).toHaveURL(/\/qr-code-generator$/);
});

// The colours card used to redraw its code with new options every step, and
// the library empties the code before drawing it again: a blank frame every
// 700ms. Its codes are drawn once now and the loop only fades between them.
test("the colours card plays through without drawing its code again", async ({ page }) => {
  await page.goto("/");
  const scene = section(page, "Print once. Change it later.")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Your logo and colours" }) })
    .locator("[data-scene]");
  await scene.scrollIntoViewIfNeeded();
  // One code per colour, all drawn, before the count starts.
  await expect(scene.locator("[role=img] svg")).toHaveCount(3);
  await expect(scene.locator("[role=img] svg path").first()).toBeAttached();
  await scene.evaluate((el) => {
    el.dataset.redraws = "0";
    new MutationObserver((records) => {
      el.dataset.redraws = String(Number(el.dataset.redraws) + records.length);
    }).observe(el, { childList: true, subtree: true });
  });

  const seen = new Set<string | null>();
  await expect
    .poll(
      async () => {
        seen.add(await scene.getAttribute("data-step"));
        return seen.size;
      },
      { intervals: [250], timeout: 6_000 },
    )
    .toBeGreaterThan(4);
  await expect(scene).toHaveAttribute("data-redraws", "0");
});

// Comparisons belong on the comparison pages. The sections sell what you get
// without naming anybody else.
test("the landing sections name no competitor", async ({ page }) => {
  await page.goto("/");
  for (const name of [
    "Branded short links.",
    "Print once. Change it later.",
    "See which post paid off.",
  ]) {
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name }) });
    await expect(section).not.toContainText(/bitly|rebrandly|dub|short\.io/i);
  }
});

// A card plays its loop while it is on screen, from the finished state the
// page arrives in; under reduced motion it stays finished.
const linkScene = async (page: Page) => {
  const scene = section(page, "Branded short links.").locator("[data-scene]").nth(1);
  await scene.scrollIntoViewIfNeeded();
  return scene;
};

// Holding still has no moment to wait for, so the card is watched for two
// seconds, longer than a playing card takes to change step.
const steps = async (page: Page) => {
  const scene = await linkScene(page);
  const seen = new Set<string | null>();
  for (let i = 0; i < 8; i++) {
    seen.add(await scene.getAttribute("data-step"));
    await page.waitForTimeout(250);
  }
  return seen;
};

test("the cards play while they are on screen", async ({ page }) => {
  await page.goto("/");
  const scene = await linkScene(page);
  const first = await scene.getAttribute("data-step");
  expect(first).not.toBeNull();
  await expect(scene).not.toHaveAttribute("data-step", first!, { timeout: 2_000 });
});

test("under reduced motion the cards hold their finished state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const seen = await steps(page);
  expect([...seen]).toEqual(["6"]);
  await expect(section(page, "Branded short links.").locator("[data-scene]").nth(1)).toContainText(
    "Available on go.acme.com",
  );
});
