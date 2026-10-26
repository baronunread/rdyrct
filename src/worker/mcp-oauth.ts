import * as v from "valibot";
import type { JsonValue } from "../shared/types";
import type { Env } from "./env";

/** The MCP OAuth provider's protected-resource identifier (RFC 8707): the
 * audience every access token it issues is bound to. Shared between
 * better-auth.ts (plugin config) and session.ts (token verification) so the
 * two can never drift apart. */
export function mcpResource(env: Env): string {
  return `${env.APP_URL}/api/mcp`;
}

/** The two registration fields this reads; everything else passes through. */
const registrationSchema = v.looseObject({
  application_type: v.optional(v.string()),
  redirect_uris: v.optional(v.array(v.string())),
});

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isHttpLoopback(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * A dynamic registration with no `application_type` is a web client to
 * better-auth (RFC 7591's default), and a web client may not redirect to
 * http://localhost. Claude Code, Cursor and VS Code register exactly that
 * (the MCP SDK never sends `application_type`), so every one of them would
 * be refused. A loopback callback means a program on the user's own machine,
 * which is what `native` says, so name it before better-auth reads the body.
 * The native rules still refuse anything that is neither loopback http nor
 * https.
 */
export async function defaultNativeRegistration(request: Request): Promise<Request> {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/api/auth/oauth2/register")
    return request;
  let body: JsonValue;
  try {
    body = await request.clone().json();
  } catch {
    return request;
  }
  const parsed = v.safeParse(registrationSchema, body);
  if (!parsed.success || parsed.output.application_type !== undefined) return request;
  if (!parsed.output.redirect_uris?.some(isHttpLoopback)) return request;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...parsed.output, application_type: "native" }),
  });
}

const ABANDONED_CLIENT_AGE_MS = 24 * 60 * 60 * 1000;
const ABANDONED_CLIENT_SWEEP_CHUNK = 500;

/**
 * Open dynamic client registration writes a row for anyone who asks, and a
 * client that registers and never sends a user through consent leaves that
 * row behind forever. Deletes anonymous DCR clients (no discovery URL, no
 * owning user) older than a day that never got a consent or a token: a real
 * client finishes consent within minutes of registering, and one that comes
 * back later just registers again. Its oauth_client_resource rows cascade.
 */
export async function sweepAbandonedOAuthClients(env: Env): Promise<number> {
  const stmt = env.DB.prepare(
    `delete from oauth_client where id in (
       select c.id from oauth_client c
       where c.client_discovery_id is null and c.user_id is null and c.reference_id is null
         and c.created_at < ?
         and not exists (select 1 from oauth_consent where client_id = c.client_id)
         and not exists (select 1 from oauth_access_token where client_id = c.client_id)
         and not exists (select 1 from oauth_refresh_token where client_id = c.client_id)
       limit ?
     )`,
  );
  const cutoff = Date.now() - ABANDONED_CLIENT_AGE_MS;
  let deleted = 0;
  let changes = 0;
  do {
    changes = (await stmt.bind(cutoff, ABANDONED_CLIENT_SWEEP_CHUNK).run()).meta.changes;
    deleted += changes;
  } while (changes > 0);
  return deleted;
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
