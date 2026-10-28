/** A URL the way a person reads it: no scheme, no trailing slash.
 * "https://copperkettle.co/" reads "copperkettle.co". */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** Where a subdomain's DNS lives: "links.copperkettle.co" is managed at
 * "copperkettle.co". An apex hostname is its own zone. A guess for the
 * sentence, never for anything that resolves. */
export function parentDomain(hostname: string): string {
  const labels = hostname.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : hostname;
}
