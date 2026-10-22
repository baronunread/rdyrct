/**
 * Whether a build is rdyrct.com itself or somebody's self-hosted copy.
 *
 * `VITE_RDYRCT_SITE=1` makes it rdyrct.com; anything else, including no
 * value, builds a self-hosted copy. Set it in the shell or in `.env`, which
 * is gitignored: a fork copies everything that is committed, so a committed
 * answer would hand every fork rdyrct.com's pages. Forks and the Deploy to
 * Cloudflare button never set it, so they never have to guess.
 *
 * Read through Vite's `loadEnv` because `bunx vite` runs under Node, which
 * does not load `.env` into `process.env`. A value in the shell wins.
 *
 * vite.config.ts writes the answer into `VITE_RDYRCT_SITE`, which is what
 * src/shared/site.ts reads.
 */
import { loadEnv } from "vite";

const ROOT = new URL("..", import.meta.url).pathname;

export function isRdyrctSite(env = loadEnv("production", ROOT, "VITE_RDYRCT_SITE")): boolean {
  return env.VITE_RDYRCT_SITE === "1";
}

/**
 * Whether a wrangler.jsonc still describes rdyrct.com's own deployment. On a
 * fork that means `bun run setup` has not run yet; deploy.ts also uses it to
 * catch a flag that disagrees with the deploy target.
 */
export function namesRdyrct(wrangler: string): boolean {
  return /"APP_HOST"\s*:\s*"rdyrct\.com"/.test(wrangler);
}
