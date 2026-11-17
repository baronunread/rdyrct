/**
 * `Disallow` stops crawling, not listing, and hides a noindex from the crawler.
 * So app pages stay crawlable and answer `X-Robots-Tag: noindex`. /login and
 * /report are listed on purpose: indexed, they only add thin pages.
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
  "login",
  "report",
]);

function isNoindexPath(pathname: string): boolean {
  const root = pathname.split("/")[1];
  return root !== undefined && NOINDEX_ROOTS.has(root.toLowerCase());
}

/** Copies the response: the asset binding's headers are immutable. */
export function withNoindex(response: Response, url: URL): Response {
  if (!isNoindexPath(url.pathname)) return response;
  const copy = new Response(response.body, response);
  copy.headers.set("x-robots-tag", "noindex");
  return copy;
}
