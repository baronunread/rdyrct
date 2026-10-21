/**
 * The files in public/ that describe rdyrct.com and nothing else: its
 * sitemap, the guides it writes for AI crawlers, and the share image its
 * head tags name. A self-hosted build drops them, and its robots.txt asks
 * crawlers to stay out: a private copy has no pages to be found, and short
 * links are not pages.
 *
 *   called by scripts/prerender-public.tsx for any build that is not rdyrct.com
 */
import { rm } from "node:fs/promises";

const SITE_ONLY_FILES = ["sitemap.xml", "llms.txt", "llms-full.txt", "ai.txt", "og.png"];

const SELF_HOST_ROBOTS = "User-agent: *\nDisallow: /\n";

export async function writeSelfHostFiles(dir: string) {
  await Promise.all(SITE_ONLY_FILES.map((file) => rm(`${dir}/${file}`, { force: true })));
  await Bun.write(`${dir}/robots.txt`, SELF_HOST_ROBOTS);
}
