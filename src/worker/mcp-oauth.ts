import * as v from "valibot";
import type { JsonValue } from "../shared/types";
import type { Env } from "./env";

// Shared by better-auth.ts and session.ts so the two cannot drift.
export function mcpResource(env: Env): string {
  return `${env.APP_URL}/api/mcp`;
}

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

// A registration with no application_type is a web client (RFC 7591), and a web client may not redirect to http://localhost; Claude Code,
// Cursor and VS Code register exactly that. A loopback callback means native: name it before better-auth reads the body.
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

// Deletes anonymous DCR clients older than a day that never got consent or a token: a real client finishes consent in minutes,
// and one that comes back later just registers again.
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

// SSRF boundary: a client_id is an attacker-controlled URL. global_fetch_strictly_public in wrangler.jsonc covers resolving, special-use rejection and pinning;
// refusing redirects is this function: Workers redirect: manual returns the 3xx itself, so rejecting a 3xx is the check.
// Also bounded in time: Cloudflare puts no fixed limit on a subrequest duration.
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
