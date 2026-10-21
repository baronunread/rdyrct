/**
 * Whether a build is rdyrct.com itself or somebody's self-hosted copy.
 *
 * `VITE_RDYRCT_SITE` decides when it is set ("1" or "0"). Otherwise the
 * deploy target does: wrangler.jsonc with `APP_HOST` rdyrct.com is this
 * site, any other host is a fork. Reading the target rather than trusting a
 * command name means `bun run deploy` and a bare `vite build` cannot ship
 * rdyrct.com without its pages, or a fork with them.
 *
 * One exception: Cloudflare's own builds (`WORKERS_CI=1`) are always a fork.
 * That is how the README's "Deploy to Cloudflare" button builds, and it runs
 * on a fresh copy of this repo whose wrangler.jsonc still names rdyrct.com.
 * rdyrct.com deploys from `bun run deploy`, never from there.
 *
 * vite.config.ts writes the answer into `VITE_RDYRCT_SITE`, which is what
 * src/shared/site.ts reads.
 */
import { readFileSync } from "node:fs";

const WRANGLER = new URL("../wrangler.jsonc", import.meta.url);

type BuildEnv = { VITE_RDYRCT_SITE?: string; WORKERS_CI?: string };

export function isRdyrctSite(
  env: BuildEnv = process.env,
  wrangler = readFileSync(WRANGLER, "utf8"),
): boolean {
  const flag = env.VITE_RDYRCT_SITE;
  if (flag === "1" || flag === "0") return flag === "1";
  if (env.WORKERS_CI === "1") return false;
  return /"APP_HOST"\s*:\s*"rdyrct\.com"/.test(wrangler);
}
