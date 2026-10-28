/** Local dev and built previews must never send events to the production project. */
export function posthogTokenForHost(
  hostname: string,
  productionToken: string | undefined,
  developmentToken: string | undefined,
  developmentBuild = false,
): string | undefined {
  const local =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    // portless's LAN mode (scripts/dev-hosts.ts)
    hostname.endsWith(".local") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  return local || developmentBuild ? developmentToken : productionToken;
}
