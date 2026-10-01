/** The link's display title: its full address without the scheme, e.g.
 * "rdyr.cc/abc" or "go.brand.com/spring". */
export function linkDisplayTitle(url: string) {
  return url.replace(/^https?:\/\//, "");
}
