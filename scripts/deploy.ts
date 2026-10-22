/**
 * `bun run deploy`, for rdyrct.com and for a self-hosted copy alike.
 *
 * `VITE_RDYRCT_SITE=1` (scripts/site-mode.ts) makes it rdyrct.com, which
 * also builds source maps and sends them to PostHog before the deploy; the
 * upload deletes them from dist/, so no map is ever served. The flag has to
 * agree with wrangler.jsonc's `APP_HOST`, or nothing ships: a forgotten flag
 * would put rdyrct.com live without its landing page, and a stray one would
 * give a fork rdyrct.com's pages and analytics.
 */
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { deploySelfHosted } from "./setup";
import { isRdyrctSite, namesRdyrct } from "./site-mode";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const site = isRdyrctSite();

// The Deploy to Cloudflare button, and every later push to the repository it
// made: Cloudflare builds a copy whose wrangler.jsonc still describes
// rdyrct.com, so it gets the self-hosted config on the way through.
if (process.env.WORKERS_CI === "1" && !site && namesRdyrct(source)) {
  const host = await deploySelfHosted({ source, dropIds: false });
  console.log(`Deployed a self-hosted copy to https://${host}`);
  process.exit(0);
}

if (site !== namesRdyrct(source)) {
  console.error(
    site
      ? "VITE_RDYRCT_SITE=1 builds rdyrct.com, but wrangler.jsonc deploys somewhere else. Remove the flag."
      : "wrangler.jsonc still deploys to rdyrct.com. Run `bun run setup` to set up your own copy, or, on rdyrct.com, add VITE_RDYRCT_SITE=1 to .env.",
  );
  process.exit(1);
}

console.log(site ? "Deploying rdyrct.com" : "Deploying a self-hosted copy");

await $`bun run build`.env({ ...process.env, POSTHOG_SOURCEMAPS: site ? "1" : "0" });
if (site) await $`bun run posthog:upload`;
// A self-hosted copy migrates first, so new code never meets an old schema.
else await $`bunx wrangler d1 migrations apply DB --remote`;
await $`bunx wrangler deploy`;
