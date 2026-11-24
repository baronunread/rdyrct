/**
 * The flag must agree with wrangler.jsonc's `APP_HOST`, or nothing ships: a forgotten flag would put rdyrct.com live
 * without its landing page, a stray one would give a fork rdyrct.com's pages. The rdyrct.com build sends source
 * maps to PostHog; the upload deletes them from dist/.
 */
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { deploySelfHosted } from "./setup";
import { isRdyrctSite, namesRdyrct } from "./site-mode";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const site = isRdyrctSite();

// Cloudflare builds a copy whose wrangler.jsonc still describes rdyrct.com, so it gets the self-hosted config.
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

// Extra flags go to wrangler deploy, e.g. `--secrets-file` to change a secret in the same version as the code.
const deployFlags = process.argv.slice(2);
if (deployFlags.includes("--dry-run")) {
  console.error(
    "No --dry-run: the source map upload and D1 migrations run first, for real. Use `bunx wrangler deploy --dry-run`.",
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
// Migrate first, so new code never meets an old schema. CI=true skips Wrangler's prompt: answering "n" exits 0
// having applied nothing, and the deploy would ship anyway.
await $`bunx wrangler d1 migrations apply DB --remote`.env({ ...process.env, CI: "true" });
await $`bunx wrangler deploy ${deployFlags}`;
