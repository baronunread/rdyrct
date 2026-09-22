import type { Env } from "./env";

/** The MCP OAuth provider's protected-resource identifier (RFC 8707): the
 * audience every access token it issues is bound to. Shared between
 * better-auth.ts (plugin config) and session.ts (token verification) so the
 * two can never drift apart. */
export function mcpResource(env: Env): string {
  return `${env.APP_URL}/api/mcp`;
}

/**
 * CIMD's client-metadata fetch: a client_id is an unauthenticated URL an
 * attacker controls, so this is the SSRF boundary for that flow (see
 * @better-auth/cimd's `fetchClientMetadataResource` contract).
 *
 * Three of its four obligations — resolve the hostname once, reject
 * RFC 6890 special-use addresses, pin the resolved address — are the
 * platform's job: `global_fetch_strictly_public` in wrangler.jsonc makes a
 * Worker's own `fetch` refuse anything not public-routable, which is exactly
 * what a Worker can enforce (it has no socket API to pin a connection by
 * hand). The fourth, refusing redirects, is this function's: Workers'
 * `redirect: "manual"` hands back the 3xx itself rather than an opaque
 * redirect (that's a browser-fetch concept this runtime doesn't have), so
 * rejecting a 3xx status is the whole check.
 *
 * A slow or stalled response from that URL would otherwise hold the
 * authorization request open for as long as the client cared to wait
 * (Cloudflare puts no fixed limit on a subrequest's own duration), so this
 * also bounds it.
 */
const CLIENT_METADATA_TIMEOUT_MS = 5_000;

export async function fetchClientMetadataResource(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const timeout = AbortSignal.timeout(CLIENT_METADATA_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const res = await fetch(input, { ...init, redirect: "manual", signal });
  if (res.status >= 300 && res.status < 400)
    throw new Error("Client metadata fetch refused a redirect.");
  return res;
}
