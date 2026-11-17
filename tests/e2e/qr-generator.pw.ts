import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";

declare global {
  interface Window {
    jsQR: typeof import("jsqr").default;
  }
}

function watchPosts(page: Page): string[] {
  const posted: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posted.push(r.url());
  });
  return posted;
}

function appPosts(page: Page, posted: string[]): string[] {
  const appOrigin = new URL(page.url()).origin;
  return posted.filter((url) => new URL(url).origin === appOrigin);
}

interface ScannedCode {
  data: string;
  version: number;
}

/**
 * jsQR, not BarcodeDetector: Chromium on Linux lacks it, so this check never ran on CI.
 * Injected into about:blank, out from under the app's CSP.
 */
async function readCode(page: Page, markup: string): Promise<ScannedCode | null> {
  await page.goto("about:blank");
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve("jsqr") });

  return page.evaluate(async (svg) => {
    const image = new Image();
    await new Promise((done, fail) => {
      image.onload = done;
      image.onerror = fail;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = Object.assign(document.createElement("canvas"), {
      width: image.width,
      height: image.height,
    });
    const context = canvas.getContext("2d");
    context?.drawImage(image, 0, 0);
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height);
    if (!pixels) return null;
    const found = window.jsQR(pixels.data, pixels.width, pixels.height);
    return found ? { data: found.data, version: found.version } : null;
  }, markup);
}

async function downloadCode(page: Page, format: "PNG" | "SVG") {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: new RegExp(format) }).click(),
  ]);
  return download;
}

test("generates a QR code with no account and no network call", async ({ page }) => {
  // Drawn locally, as the page claims: anything posted while typing would make that false.
  const posted = watchPosts(page);

  await page.goto("/qr-code-generator");
  await expect(page.getByRole("heading", { name: "QR code generator" })).toBeVisible();

  const code = page.getByRole("img", { name: /^QR code for/ });
  const upsell = page.getByRole("heading", { name: "Want to know if anyone scans it?" });

  // The downloads row exists before there is anything to download, so it cannot shift the page.
  await expect(page.getByRole("button", { name: /PNG/ })).toBeDisabled();

  await page.getByLabel("Link or text").fill("https://example.com/printed-poster");

  await expect(code.locator("svg")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /PNG/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /SVG/ })).toBeEnabled();
  await expect(upsell).toBeVisible();
  await expect(page.getByRole("link", { name: "How QR code tracking works" })).toHaveAttribute(
    "href",
    "/blog/qr-code-tracking",
  );

  expect(appPosts(page, posted)).toEqual([]);
});

test("downloads a printable PNG", async ({ page }) => {
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/download-me");

  expect(await (await downloadCode(page, "PNG")).path()).toBeTruthy();
});

test("the upsell offers the account rather than making a link", async ({ page }) => {
  // The offer used to post to the anonymous shortener, against the page's claim that nothing leaves the browser.
  const posted = watchPosts(page);

  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/trackable");
  await expect(page.getByRole("button", { name: /SVG/ })).toBeVisible({ timeout: 10_000 });

  const upsell = page.getByRole("heading", { name: "Want to know if anyone scans it?" });
  await expect(upsell).toBeVisible();
  await expect(page.getByRole("link", { name: "See Hobby and Pro" })).toHaveAttribute(
    "href",
    "/pricing",
  );

  expect(appPosts(page, posted)).toEqual([]);

  await page.getByRole("link", { name: "Start free" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("the page is reachable from the footer of the landing page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "QR generator" }).click();
  await expect(page.getByRole("heading", { name: "QR code generator" })).toBeVisible();
});

test("styling the code is free here, and stays in the browser", async ({ page }) => {
  const posted = watchPosts(page);

  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/styled");

  for (const group of ["Dots", "Corners", "Colours"]) {
    await expect(page.getByRole("group", { name: group, exact: true })).toBeVisible();
  }
  for (const chip of ["Dots", "Corners", "Background"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${chip} colour`) })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();

  const dots = page.getByRole("group", { name: "Dots", exact: true });
  await dots.getByRole("button", { name: "Square", exact: true }).click();
  await expect(dots.getByRole("button", { name: "Square", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: /PNG/ })).toBeEnabled();

  expect(appPosts(page, posted)).toEqual([]);
});

test("the page says what it is built on, and carries its own title", async ({ page }) => {
  await page.goto("/qr-code-generator");

  // Its own title and canonical: sharing the landing page's made two pages compete for one result.
  await expect(page).toHaveTitle(/QR code generator/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/qr-code-generator$/,
  );

  await expect(page.getByRole("link", { name: "qr-code-styling" })).toBeVisible();
  await expect(page.getByRole("link", { name: "SVGO" })).toBeVisible();
  await expect(page.getByText(/should be free and open source/i)).toBeVisible();
});

test("a logo lands in the middle of the code instead of blanking it", async ({ page }) => {
  // qr-code-styling fetches the logo by XHR, which browsers refuse for a data URL, so the
  // drawing never finished and the preview went white.
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/with-a-logo");

  const code = page.getByRole("img", { name: /^QR code for/ });
  await expect(code.locator("svg image")).toHaveCount(0);

  await page.setInputFiles('input[type="file"]', "tests/e2e/fixtures/logo.png");
  await expect(page.getByText("logo.png")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Replace" })).toBeVisible();

  await expect(code.locator("svg image")).toHaveCount(1, { timeout: 20_000 });

  const modules = await code
    .locator("svg path[d]")
    .evaluateAll((paths) =>
      paths.reduce((total, path) => total + (path.getAttribute("d")?.match(/M/g)?.length ?? 0), 0),
    );
  expect(modules).toBeGreaterThan(100);
});

test("the downloaded SVG has no seams to show when it is scaled up", async ({ page }) => {
  // Renderers combine the clipPath's per-module coverage, leaving a pale grid on shared
  // edges that only shows when the vector is scaled. Asserted on the exported file.
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/printed-large");

  const svg = await readFile(await (await downloadCode(page, "SVG")).path(), "utf8");

  const crowded = [...svg.matchAll(/<clipPath[^>]*>([\s\S]*?)<\/clipPath>/g)].filter(
    ([, body]) => (body.match(/<(path|rect|circle)/g) ?? []).length > 1,
  );
  expect(crowded).toHaveLength(0);

  // One path filled in a single pass leaves no shared edges to antialias; a stroke
  // cannot cover the seam at every zoom.
  const subpaths = /<path d="(M[^"]*)" fill="[^"]*"/.exec(svg)?.[1] ?? "";
  expect((subpaths.match(/M/g) ?? []).length).toBeGreaterThan(100);
});

test("the merged code still scans", async ({ page }) => {
  // Merging bakes each module's rotation into the path by hand; a mistake still looks
  // like dots but no phone can read it.
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/still-scans");

  const svg = await readFile(await (await downloadCode(page, "SVG")).path(), "utf8");

  expect((await readCode(page, svg))?.data).toBe("https://example.com/still-scans");
});

/**
 * Error correction "H" is only worth it under a logo; here it forces a bigger grid
 * (version 4, 33 modules, against 3 at "M"). Asserted through a decoder, since the
 * version is what a scanner sees.
 */
test("a code with no logo is not padded with error correction it cannot use", async ({ page }) => {
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/printed-poster");

  const svg = await readFile(await (await downloadCode(page, "SVG")).path(), "utf8");
  const scanned = await readCode(page, svg);

  expect(scanned?.data).toBe("https://example.com/printed-poster");
  // Version 4 is what "H" produced; above 3 means the level went back up.
  expect(scanned?.version).toBe(3);
});

test("a signed-in visitor gets their dashboard link, not a sign-up button", async ({ page }) => {
  // The header was told "signed out" outright, so a signed-in user saw Log in and Sign up.
  const email = `qrheader-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, "test-password-123");

  await page.goto("/qr-code-generator");
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
});
