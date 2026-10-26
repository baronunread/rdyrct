/**
 * `bun run deploy`, for rdyrct.com and for a self-hosted copy alike.
 *
 * `VITE_RDYRCT_SITE=1` (scripts/site-mode.ts) makes it rdyrct.com, which
 * also builds source maps and sends them to PostHog before the deploy; the
 * upload deletes them from dist/, so no map is ever served. The flag has to
 * agree with wrangler.jsonc's `APP_HOST`, or nothing ships: a forgotten flag
 * would put rdyrct.com live without its landing page, and a stray one would
 * give a fork rdyrct.com's pages and analytics.
 *
 * Both builds apply D1 migrations before the Worker goes out, and stop if
 * any is still pending afterwards.
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
// Let Wrangler refresh an expired OAuth token in a command of its own. A D1
// query sent by the same command that refreshed is often refused with 7403
// (7 of 10 in a test; 0 of 26 once the refresh ran first). workers-sdk#16402.
await $`bunx wrangler whoami`.quiet();
// Migrate first, so new code never meets an old schema. To undo a migration,
// restore D1 with Time Travel (AGENTS.md, "Rolling back a release").
await $`bunx wrangler d1 migrations apply DB --remote`;
// Answering "n" at Wrangler's prompt exits 0 having applied nothing, so check
// rather than trust the exit code.
const pending = await $`bunx wrangler d1 migrations list DB --remote`.text();
if (!pending.includes("No migrations to apply")) {
  console.error("Migrations are still pending, so the Worker was not deployed.");
  process.exit(1);
}
await $`bunx wrangler deploy`;
