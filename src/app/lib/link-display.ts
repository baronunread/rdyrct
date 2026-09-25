/** The link's display title: its custom domain, or the shared link host, or
 * just the slug when neither is known yet. linkHost is a bare host (e.g.
 * "rdyr.cc"), the host shared-domain links are served from. */
export function linkDisplayTitle(
  linkHost: string | undefined,
  domain: string | null,
  slug: string,
) {
  return `${domain ?? linkHost ?? ""}/${slug}`;
}
