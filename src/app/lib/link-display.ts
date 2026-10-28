/** The link's display title: its full address without the scheme, e.g.
 * "rdyr.cc/abc" or "go.brand.com/spring". */
export function linkDisplayTitle(url: string) {
  return url.replace(/^https?:\/\//, "");
}

/** A link's own page. The domain picks the link when two share a slug, one
 * on the shared domain and one on a custom one. */
export const linkPagePath = (l: { slug: string; domain?: string | null }) =>
  l.domain ? `/links/${l.slug}?domain=${encodeURIComponent(l.domain)}` : `/links/${l.slug}`;
