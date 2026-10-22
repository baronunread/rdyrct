/**
 * `bun run deploy`, for rdyrct.com and for a self-hosted copy alike.
 *
 * Which one it is comes from wrangler.jsonc (scripts/site-mode.ts), never
 * from which command somebody remembered to type. rdyrct.com also builds
 * source maps and sends them to PostHog before the deploy; the upload deletes
 * them from dist/, so no map is ever served.
 */
import { $ } from "bun";
import { isRdyrctSite } from "./site-mode";

const site = isRdyrctSite();
console.log(site ? "Deploying rdyrct.com" : "Deploying a self-hosted copy");

await $`bun run build`.env({ ...process.env, POSTHOG_SOURCEMAPS: site ? "1" : "0" });
if (site) await $`bun run posthog:upload`;
// A self-hosted copy migrates first, so new code never meets an old schema.
else await $`bunx wrangler d1 migrations apply DB --remote`;
await $`bunx wrangler deploy`;
