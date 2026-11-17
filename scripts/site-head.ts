/** A fork must not report its visitors to rdyrct.com's analytics or claim its canonical URL, so a build that is not rdyrct.com drops what sits between SITE_ONLY markers. */
const BLOCK = /[ \t]*<!-- rdyrct\.com only -->[\s\S]*?<!-- \/rdyrct\.com only -->\n?/g;

export function siteHead(html: string, site: boolean) {
  return site ? html : html.replace(BLOCK, "");
}
