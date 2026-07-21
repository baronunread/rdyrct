export const linkLabel = (l: { domain: string | null; slug: string }) =>
  l.domain ? `${l.domain}/${l.slug}` : `/${l.slug}`;

