export function linkDisplayTitle(url: string) {
  return url.replace(/^https?:\/\//, "");
}

export const linkPagePath = (l: { slug: string; domain?: string | null }) =>
  l.domain ? `/links/${l.slug}?domain=${encodeURIComponent(l.domain)}` : `/links/${l.slug}`;
