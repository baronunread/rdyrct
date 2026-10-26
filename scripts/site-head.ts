/**
 * The parts of index.html that belong to rdyrct.com alone: its canonical
 * URL, share cards, structured data and analytics script. They sit between
 * SITE_ONLY markers, and a build that is not rdyrct.com (any
 * self-hosted one) drops them, so a fork does not report its visitors to
 * rdyrct.com's analytics or tell search engines it is rdyrct.com.
 *
 * Used by vite.config.ts in dev and build alike.
 */
const BLOCK = /[ \t]*<!-- rdyrct\.com only -->[\s\S]*?<!-- \/rdyrct\.com only -->\n?/g;

export function siteHead(html: string, site: boolean) {
  return site ? html : html.replace(BLOCK, "");
}
