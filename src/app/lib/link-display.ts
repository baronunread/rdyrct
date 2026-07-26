/** The link's display title: its custom domain, or the app host, or just
 * the slug when neither is known yet. appHost is a bare host (e.g.
 * "rdyrct.com"), the same shape domains.tsx shows for CNAME targets. */
export function linkDisplayTitle(appHost: string | undefined, domain: string | null, slug: string) {
  return `${domain ?? appHost ?? ""}/${slug}`;
}
