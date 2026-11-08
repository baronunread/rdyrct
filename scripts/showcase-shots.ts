/**
 * Takes the landing page's product screenshots (components/product-showcase)
 * from the local dev server: the `showcase` scenario's Dashboard, Analytics
 * and Links pages, light and dark, desktop and phone, saved as WebP in
 * public/showcase/. Resized and encoded with Bun.Image, so no image library.
 *
 *   bun run dev            # in another terminal
 *   bun run db:seed:local  # fresh data, so the charts end today
 *   bun run showcase:shots
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { $ } from "bun";

const app = (await $`bun scripts/dev-hosts.ts app`.text()).trim();
const out = new URL("../public/showcase/", import.meta.url).pathname;
await mkdir(out, { recursive: true });

const pages = ["dashboard", "analytics", "links"] as const;
const sizes = [
  { suffix: "", width: 1440, height: 820, scale: 2, outWidth: 1600 },
  { suffix: "-phone", width: 390, height: 600, scale: 2, outWidth: 780 },
] as const;

/** Dev-only hostnames, swapped in the page before each shot so the pictures
 *  show addresses a visitor would recognise. Text only: nothing is sent. */
const host = new URL(app).host;
const swaps: [string, string][] = [
  [host, "rdyr.cc"],
  [".test", ".com"],
];

const browser = await chromium.launch();
for (const theme of ["light", "dark"] as const) {
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale,
      ignoreHTTPSErrors: true,
      reducedMotion: "reduce",
    });
    await context.addInitScript((t) => localStorage.setItem("theme", t), theme);
    const page = await context.newPage();
    await page.goto(`${app}/__dev/scenarios/showcase?to=/dashboard`);
    for (const name of pages) {
      await page.goto(`${app}/${name}`);
      await page.waitForLoadState("networkidle");
      // Charts and counts settle after their data arrives.
      await page.waitForTimeout(1200);
      await page.evaluate((pairs) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          let text = node.nodeValue ?? "";
          for (const [from, to] of pairs) text = text.split(from).join(to);
          node.nodeValue = text;
        }
      }, swaps);
      const png = await page.screenshot();
      const file = `${out}${name}-${theme}${size.suffix}.webp`;
      await new Bun.Image(png).resize(size.outWidth).webp({ quality: 78 }).write(file);
      console.log(file.replace(out, "public/showcase/"));
    }
    await context.close();
  }
}
await browser.close();
