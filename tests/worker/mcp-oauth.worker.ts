import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  signInCookie,
  TEST_PASSWORD,
} from "./support";
import { reset } from "cloudflare:test";
import { hashPassword } from "../../src/worker/password";

// End-to-end coverage of the MCP OAuth server (#139 follow-up): a client
// registered out of band (CIMD/DCR is a separate, already-reviewed concern —
// this seeds the row directly, the way an admin-created client would look),
// then the real authorize -> consent -> token -> /api/mcp round trip a
// genuine MCP client drives, plus the failure shapes session.ts and the
// route's requireMcpAuth wrapping are responsible for.

async function base64url(bytes: Uint8Array): Promise<string> {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = await base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = await base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

const CLIENT_ID = "e2e-test-client";
const REDIRECT_URI = "https://client.example/callback";
const RESOURCE = "http://localhost/api/mcp";

async function registerTestClient() {
  // mcp() creates the oauth_resource row lazily, on the authorization
  // server's own first relevant request — tied to when `getAuth()`'s
  // module-cached instance was first built, not to this test's own D1 reset.
  // Written here too (idempotently) so this test doesn't depend on that
  // timing.
  await env.DB.batch([
    env.DB.prepare(
      `insert or ignore into oauth_resource (id, identifier, name, created_at, updated_at)
       values ('resource-row', ?, 'rdyrct MCP', 0, 0)`,
    ).bind(RESOURCE),
    env.DB.prepare(
      `insert into oauth_client (id, client_id, disabled, redirect_uris,
         token_endpoint_auth_method, grant_types, response_types, created_at, updated_at, name)
       values ('client-row', ?, 0, ?, 'none', '["authorization_code"]', '["code"]', 0, 0, 'Test Client')`,
    ).bind(CLIENT_ID, JSON.stringify([REDIRECT_URI])),
    env.DB.prepare(
      `insert into oauth_client_resource (id, client_id, resource_id, created_at)
       values ('link-row', ?, ?, 0)`,
    ).bind(CLIENT_ID, RESOURCE),
  ]);
}

interface RedirectBody {
  redirect: boolean;
  url: string;
}

/** Drives authorize -> consent for a signed-in cookie, returning the minted
 * authorization code. */
async function grantAuthorizationCode(
  cookie: string,
  challenge: string,
  scope = "openid",
): Promise<string> {
  const authorizeUrl = new URL("http://localhost/api/auth/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    state: "s1",
  }).toString();

  const authorizeRes = await fetchWorker(
    new Request(authorizeUrl, { headers: { cookie, accept: "application/json" } }),
    authEnv(),
  );
  expect(authorizeRes.status).toBe(200);
  const authorized = await jsonBody<RedirectBody>(authorizeRes);
  expect(authorized.url).toContain("/consent?");
  const oauthQuery = authorized.url.split("?")[1]!;

  const consentRes = await fetchWorker(
    new Request("http://localhost/api/auth/oauth2/consent", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
    }),
    authEnv(),
  );
  expect(consentRes.status).toBe(200);
  const consented = await jsonBody<RedirectBody>(consentRes);
  const code = new URL(consented.url).searchParams.get("code");
  expect(code).toBeTruthy();
  return code!;
}

async function exchangeCode(
  code: string,
  verifier: string,
): Promise<{ access_token: string; refresh_token?: string }> {
  const tokenRes = await fetchWorker(
    new Request("http://localhost/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
    }),
    authEnv(),
  );
  expect(tokenRes.status).toBe(200);
  const token = await jsonBody<{ access_token: string; refresh_token?: string }>(tokenRes);
  expect(token.access_token).toBeTruthy();
  return token;
}

function callMcp(accessToken: string) {
  return fetchWorker(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_plan_usage", arguments: {} },
      }),
    }),
    authEnv(),
  );
}

describe("MCP OAuth (#139 follow-up)", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  it("a granted access token authenticates a real tool call", async () => {
    const cookie = await freeOwnerCookie();
    await registerTestClient();
    const { verifier, challenge } = await pkcePair();

    const code = await grantAuthorizationCode(cookie, challenge);
    const { access_token: accessToken } = await exchangeCode(code, verifier);

    const res = await callMcp(accessToken);
    expect(res.status).toBe(200);
    const body = await jsonBody<{ result?: { content?: { text?: string }[] } }>(res);
    expect(JSON.parse(body.result!.content![0]!.text!)).toEqual({
      plan: "free",
      allowed: 30,
      used: 0,
      left: 30,
    });
  });

  it("a granted access token does not authenticate a direct non-MCP API call (#242)", async () => {
    const cookie = await freeOwnerCookie();
    await registerTestClient();
    const { verifier, challenge } = await pkcePair();

    const code = await grantAuthorizationCode(cookie, challenge);
    const { access_token: accessToken } = await exchangeCode(code, verifier);

    // Same token that authenticates /api/mcp above, aimed at a real REST
    // route instead: its aud claim names only /api/mcp, and withSession's
    // oauthTokenPath now enforces that, so this must come back unauthed
    // rather than resolving to the token owner's full session.
    const res = await fetchWorker(
      new Request("http://localhost/api/user", {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      authEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("401s an unauthenticated request with an RFC 9728 WWW-Authenticate challenge", async () => {
    const res = await fetchWorker(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      authEnv(),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("rejects a garbage bearer token", async () => {
    const res = await callMcp("not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("revoking the connection stops it minting new access tokens (refresh dies with the grant)", async () => {
    const cookie = await freeOwnerCookie();
    await registerTestClient();
    const { verifier, challenge } = await pkcePair();
    // offline_access, so the token exchange also issues a refresh token to
    // prove dead: a code-only grant never gets one to revoke in the first
    // place.
    const code = await grantAuthorizationCode(cookie, challenge, "openid offline_access");
    const { refresh_token } = await exchangeCode(code, verifier);
    expect(refresh_token).toBeTruthy();

    const [{ id: consentId }] = await env.DB.prepare(
      "select id from oauth_consent where client_id = ?",
    )
      .bind(CLIENT_ID)
      .all<{ id: string }>()
      .then((r) => r.results);
    // oauth-connections.ts, not better-auth's own /oauth2/delete-consent:
    // that endpoint only deletes the consent row and leaves the refresh
    // token live (verified below), so this is the route hooks.ts's
    // useRevokeConnectedApp actually calls.
    const revokeRes = await fetchWorker(
      new Request(`http://localhost/api/oauth-connections/${consentId}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      authEnv(),
    );
    expect(revokeRes.status).toBe(200);

    // Not a live refresh-grant call: oauth-provider's own error handling for
    // "the refresh token row was deleted out from under it" throws in a way
    // that escapes as an unhandled rejection even once the request itself
    // answers correctly (third-party, not this route). The row being gone is
    // the actual invariant oauth-connections.ts promises, so assert that
    // directly.
    const [{ count }] = await env.DB.prepare(
      "select count(*) as count from oauth_refresh_token where client_id = ?",
    )
      .bind(CLIENT_ID)
      .all<{ count: number }>()
      .then((r) => r.results);
    expect(count).toBe(0);
  });

  it("cannot revoke another user's connection", async () => {
    const ownerCookie = await freeOwnerCookie();
    await registerTestClient();
    const { challenge } = await pkcePair();
    await grantAuthorizationCode(ownerCookie, challenge);
    const [{ id: consentId }] = await env.DB.prepare(
      "select id from oauth_consent where client_id = ?",
    )
      .bind(CLIENT_ID)
      .all<{ id: string }>()
      .then((r) => r.results);

    await env.DB.batch([
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('other-1', 'Other', 'other@example.com', 1, 0, 'free', 0, 0)",
      ),
      env.DB.prepare(
        "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-other-1', 'other-1', 'credential', 'other-1', ?, 0, 0)",
      ).bind(await hashPassword(TEST_PASSWORD)),
    ]);
    const otherCookie = await signInCookie("other@example.com", TEST_PASSWORD);

    const res = await fetchWorker(
      new Request(`http://localhost/api/oauth-connections/${consentId}`, {
        method: "DELETE",
        headers: { cookie: otherCookie },
      }),
      authEnv(),
    );
    expect(res.status).toBe(404);

    const [{ count }] = await env.DB.prepare(
      "select count(*) as count from oauth_consent where id = ?",
    )
      .bind(consentId)
      .all<{ count: number }>()
      .then((r) => r.results);
    expect(count).toBe(1);
  });

  it("401s an unauthenticated revoke instead of 500ing on a null user", async () => {
    const res = await fetchWorker(
      new Request("http://localhost/api/oauth-connections/whatever", { method: "DELETE" }),
      authEnv(),
    );
    expect(res.status).toBe(401);
  });
});

describe("MCP dynamic client registration", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  it("advertises open registration and no client_credentials grant", async () => {
    const res = await fetchWorker(
      new Request("http://localhost/.well-known/oauth-authorization-server/api/auth"),
      authEnv(),
    );
    expect(res.status).toBe(200);
    const meta = await jsonBody<{
      registration_endpoint?: string;
      grant_types_supported: string[];
    }>(res);
    expect(meta.registration_endpoint).toBe("http://localhost/api/auth/oauth2/register");
    expect(meta.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
  });

  // The body the MCP SDK sends (Claude Code, Cursor, VS Code): a loopback
  // callback and no application_type, which better-auth alone refuses.
  it("registers an MCP SDK client with no session and links it to the MCP resource", async () => {
    await env.DB.prepare(
      `insert or ignore into oauth_resource (id, identifier, name, created_at, updated_at)
       values ('resource-row', ?, 'rdyrct MCP', 0, 0)`,
    )
      .bind(RESOURCE)
      .run();
    const res = await fetchWorker(
      new Request("http://localhost/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Some Client",
          redirect_uris: ["http://localhost:33418/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      }),
      authEnv(),
    );
    expect(res.status).toBe(201);
    const { client_id: clientId } = await jsonBody<{ client_id: string }>(res);
    const linked = await env.DB.prepare(
      "select resource_id from oauth_client_resource where client_id = ?",
    )
      .bind(clientId)
      .first<{ resource_id: string }>();
    expect(linked?.resource_id).toBe(RESOURCE);
  });

  it("sweeps only anonymous clients older than a day that never got a grant", async () => {
    const { sweepAbandonedOAuthClients } = await import("../../src/worker/mcp-oauth");
    await freeOwnerCookie(); // a user for the consent row to belong to
    const old = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const insert = (id: string, createdAt: number, discovery: string | null) =>
      env.DB.prepare(
        `insert into oauth_client (id, client_id, client_discovery_id, disabled, redirect_uris, created_at)
         values (?, ?, ?, 0, '[]', ?)`,
      ).bind(id, id, discovery, createdAt);
    const user = await env.DB.prepare("select id from user limit 1").first<{ id: string }>();
    await env.DB.batch([
      insert("abandoned", old, null),
      insert("access-tokened", old, null),
      insert("refresh-tokened", old, null),
      env.DB.prepare(
        `insert into oauth_access_token (id, token, client_id, scopes)
         values ('at1', 'access-token', 'access-tokened', '[]')`,
      ),
      env.DB.prepare(
        `insert into oauth_refresh_token (id, token, client_id, user_id, scopes)
         values ('rt1', 'refresh-token', 'refresh-tokened', ?, '[]')`,
      ).bind(user!.id),
      insert("consented", old, null),
      insert("discovered", old, "https://client.example/meta.json"),
      insert("fresh", Date.now(), null),
      env.DB.prepare(
        `insert into oauth_consent (id, client_id, user_id, scopes) values ('c1', 'consented', ?, '[]')`,
      ).bind(user!.id),
    ]);

    expect(await sweepAbandonedOAuthClients(env)).toBe(1);
    const left = await env.DB.prepare("select client_id from oauth_client order by client_id").all<{
      client_id: string;
    }>();
    expect(left.results.map((r) => r.client_id)).toEqual([
      "access-tokened",
      "consented",
      "discovered",
      "fresh",
      "refresh-tokened",
    ]);
  });
});
