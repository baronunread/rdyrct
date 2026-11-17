/** A self-hosted build drops these rdyrct.com-only files, and its robots.txt disallows everything: short links are not pages. */
import { rm } from "node:fs/promises";

const SITE_ONLY_FILES = ["sitemap.xml", "llms.txt", "llms-full.txt", "ai.txt", "og.png"];

const SELF_HOST_ROBOTS = "User-agent: *\nDisallow: /\n";

export async function writeSelfHostFiles(dir: string) {
  await Promise.all(SITE_ONLY_FILES.map((file) => rm(`${dir}/${file}`, { force: true })));
  await Bun.write(`${dir}/robots.txt`, SELF_HOST_ROBOTS);
}
