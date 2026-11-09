/**
 * Pages that must stay out of a search index: the signed-in app and the
 * one-off flows around it.
 *
 * robots.txt cannot do this. `Disallow` stops a crawler fetching a page, not
 * listing it (a link from elsewhere is enough), and it also stops the crawler
 * from ever reading a noindex. So the app pages are left crawlable and answer
 * with `X-Robots-Tag: noindex`. Public pages (the marketing pages, /login,
 * /signup, /privacy, /terms) are not in this list on purpose.
 */
const NOINDEX_ROOTS: ReadonlySet<string> = new Set([
  "dashboard",
  "analytics",
  "links",
  "domains",
  "members",
  "organization",
  "billing",
  "settings",
  "api-keys",
  "import",
  "admin",
  "onboarding",
  "welcome",
  "reset-password",
  "invite",
  "consent",
]);

/** True for an app page or anything beneath one (/links/<slug>, /invite/<token>). */
function isNoindexPath(pathname: string): boolean {
  const root = pathname.split("/")[1];
  return root !== undefined && NOINDEX_ROOTS.has(root.toLowerCase());
}

/** The response with `X-Robots-Tag: noindex` when its path is an app page.
 *  Copies the response: the asset binding's headers are immutable. */
export function withNoindex(response: Response, url: URL): Response {
  if (!isNoindexPath(url.pathname)) return response;
  const copy = new Response(response.body, response);
  copy.headers.set("x-robots-tag", "noindex");
  return copy;
}
