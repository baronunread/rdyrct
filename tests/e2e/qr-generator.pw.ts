import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";

/**
 * The standalone QR generator (Direction D of #96).
 *
 * It exists to answer a search with a working tool, so the things worth
 * asserting are that it works without an account and that it does not
 * quietly need one.
 */

/** Records every POST the page makes, so "nothing leaves the browser" can be
 * asserted rather than asserted about. Cap's own challenge and redeem are the
 * one exception, and only when somebody asks for a trackable link. */
function watchPosts(page: Page): string[] {
  const posted: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posted.push(r.url());
  });
  return posted;
}

/** What the page sent that was not Cap proving the visitor is human. */
function appPosts(posted: string[]): string[] {
  return posted.filter((url) => !url.includes("/api/cap/"));
}

/** Clicks a download button and hands back the file that arrived. */
async function downloadCode(page: Page, format: "PNG" | "SVG") {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: new RegExp(format) }).click(),
  ]);
  return download;
}

test("generates a QR code with no account and no network call", async ({ page }) => {
  // Nothing typed here should leave the browser: the code is drawn locally,
  // which the page states outright. Anything posted while merely typing
  // would make that claim false.
  const posted = watchPosts(page);

  await page.goto("/qr-code-generator");
  await expect(page.getByRole("heading", { name: "Free QR code generator" })).toBeVisible();

  const code = page.getByRole("img", { name: /^QR code for/ });
  const upsell = page.getByRole("heading", { name: "This code cannot be tracked" });

  // The download row is there before there is anything to download, so it
  // cannot appear on the first keystroke and shove the page down. It used to
  // cost 43px of shift.
  await expect(page.getByRole("button", { name: /PNG/ })).toBeDisabled();
  const settled = await upsell.boundingBox();

  await page.getByLabel("Link or text").fill("https://example.com/printed-poster");

  await expect(code.locator("svg")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /PNG/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /SVG/ })).toBeEnabled();
  expect((await upsell.boundingBox())?.y).toBe(settled?.y);

  expect(appPosts(posted)).toEqual([]);
});

test("downloads a printable PNG", async ({ page }) => {
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/download-me");

  expect(await (await downloadCode(page, "PNG")).path()).toBeTruthy();
});

test("the upsell offers the account rather than making a link", async ({ page }) => {
  // The offer used to be a button that quietly posted to the anonymous
  // shortener, on a page whose claim is that nothing you type leaves the
  // browser. Now it points at the account, and the page still makes no
  // request of its own with a code on screen and the offer read.
  const posted = watchPosts(page);

  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/trackable");
  await expect(page.getByRole("button", { name: /SVG/ })).toBeVisible({ timeout: 10_000 });

  const upsell = page.getByRole("heading", { name: "This code cannot be tracked" });
  await expect(upsell).toBeVisible();
  await expect(page.getByRole("link", { name: "See Hobby and Pro" })).toHaveAttribute(
    "href",
    "/#pricing",
  );

  expect(appPosts(posted)).toEqual([]);

  await page.getByRole("link", { name: "Start free" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("the page is reachable from the footer of the landing page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "QR generator" }).click();
  await expect(page.getByRole("heading", { name: "Free QR code generator" })).toBeVisible();
});

test("styling the code is free here, and stays in the browser", async ({ page }) => {
  // The paid feature inside the app is the same form, minus the account.
  // What this pins down is that the controls are all present and none of
  // them needs a session, because that is the whole offer of the page.
  const posted = watchPosts(page);

  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/styled");

  for (const control of ["Dot style", "Corner style", "Dot color", "Eye color", "Background"]) {
    await expect(page.getByRole("button", { name: control })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Upload a logo image" })).toBeVisible();

  // Change one and the code redraws rather than erroring.
  await page.getByRole("button", { name: "Dot style" }).click();
  await page.getByRole("menuitem", { name: "dots" }).click();
  await expect(page.getByRole("button", { name: /PNG/ })).toBeVisible();

  expect(appPosts(posted)).toEqual([]);
});

test("the page says what it is built on, and carries its own title", async ({ page }) => {
  await page.goto("/qr-code-generator");

  // Its own title and canonical: sharing the landing page's made two pages
  // compete for one search result.
  await expect(page).toHaveTitle(/QR code generator/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/qr-code-generator$/,
  );

  // The libraries doing the work are named and linked.
  await expect(page.getByRole("link", { name: "qr-code-styling" })).toBeVisible();
  await expect(page.getByRole("link", { name: "SVGO" })).toBeVisible();
  await expect(page.getByText(/free as in beer/i)).toBeVisible();
});

test("a logo lands in the middle of the code instead of blanking it", async ({ page }) => {
  // The bug: qr-code-styling fetches the logo with XHR to inline it, which a
  // browser refuses for the data URL this page produces, so the drawing never
  // finished and the preview went white. Asserted on the drawing itself
  // rather than on a screenshot, since "still renders" is the whole claim.
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/with-a-logo");

  const code = page.getByRole("img", { name: /^QR code for/ });
  await expect(code.locator("svg image")).toHaveCount(0);

  await page.setInputFiles('input[type="file"]', "tests/e2e/fixtures/logo.png");
  await expect(page.getByText("Logo added")).toBeVisible({ timeout: 20_000 });

  // The logo is in, and the code is still a code: dots as well as the image.
  await expect(code.locator("svg image")).toHaveCount(1, { timeout: 20_000 });

  // Counted as subpaths of the merged path, since the modules are one shape.
  const modules = await code
    .locator("svg path[d]")
    .evaluateAll((paths) =>
      paths.reduce((total, path) => total + (path.getAttribute("d")?.match(/M/g)?.length ?? 0), 0),
    );
  expect(modules).toBeGreaterThan(100);
});

test("the downloaded SVG has no seams to show when it is scaled up", async ({ page }) => {
  // qr-code-styling paints the dots as one solid rect through a clipPath
  // holding every module. Renderers work that clip out a shape at a time and
  // combine the coverage, so every shared edge came out short of opaque: a
  // pale grid over the code, invisible in the PNG (rasterized at its own size)
  // and plain the moment somebody scaled the vector, which is what a vector is
  // for. Asserted on the file that leaves the browser.
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/printed-large");

  const svg = await readFile(await (await downloadCode(page, "SVG")).path(), "utf8");

  // No clip is left holding a crowd of shapes.
  const crowded = [...svg.matchAll(/<clipPath[^>]*>([\s\S]*?)<\/clipPath>/g)].filter(
    ([, body]) => (body.match(/<(path|rect|circle)/g) ?? []).length > 1,
  );
  expect(crowded).toHaveLength(0);

  // They are one path instead, filled in a single pass, so the edges modules
  // share are interior to the region and never rasterized. Nothing narrower
  // works: two abutting shapes antialias against each other however they are
  // drawn, and a stroke wide enough to cover that at one zoom is invisible at
  // the next.
  const subpaths = /<path d="(M[^"]*)" fill="[^"]*"/.exec(svg)?.[1] ?? "";
  expect((subpaths.match(/M/g) ?? []).length).toBeGreaterThan(100);
});

test("the merged code still scans", async ({ page }) => {
  // Merging bakes each module's rotation into its own path data by hand. Get
  // that wrong and the code is still a plausible-looking grid of dots that no
  // phone can read, which no structural assertion would catch.
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/still-scans");

  const svg = await readFile(await (await downloadCode(page, "SVG")).path(), "utf8");

  const decoded = await page.evaluate(async (markup) => {
    const image = new Image();
    await new Promise((done, fail) => {
      image.onload = done;
      image.onerror = fail;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
    const canvas = Object.assign(document.createElement("canvas"), {
      width: image.width,
      height: image.height,
    });
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    // Chromium ships BarcodeDetector, so the code is read by the same kind of
    // decoder a phone camera uses rather than by us re-reading our own dots.
    const found = await new BarcodeDetector({ formats: ["qr_code"] }).detect(canvas);
    return found.map((code) => code.rawValue);
  }, svg);

  expect(decoded).toEqual(["https://example.com/still-scans"]);
});

test("a signed-in visitor gets their dashboard link, not a sign-up button", async ({ page }) => {
  // The header was told "signed out" outright, so somebody with a session
  // saw Log in and Sign up, clicked one, and landed on the dashboard they
  // already had.
  const email = `qrheader-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, "test-password-123");

  await page.goto("/qr-code-generator");
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
});
