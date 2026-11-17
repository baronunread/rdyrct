/**
 * Set `VITE_RDYRCT_SITE` in the shell or the gitignored `.env`, never a committed file: a fork copies it and would
 * get rdyrct.com's pages. Read via `loadEnv` because `bunx vite` runs under Node, which does not load `.env`.
 */
import { loadEnv } from "vite";

const ROOT = new URL("..", import.meta.url).pathname;

export function isRdyrctSite(env = loadEnv("production", ROOT, "VITE_RDYRCT_SITE")): boolean {
  return env.VITE_RDYRCT_SITE === "1";
}

/** On a fork this means `bun run setup` has not run yet; deploy.ts also uses it to catch a flag that disagrees with the target. */
export function namesRdyrct(wrangler: string): boolean {
  return /"APP_HOST"\s*:\s*"rdyrct\.com"/.test(wrangler);
}
