import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./environment";
import { rawSql } from "./db";
import { signUpAndVerify } from "./resend";

const E2E_PASSWORD = "test-password-123";
// A real, resolvable domain, not a documentation-only one (.example/.test):
// the browser actually navigates here when consent completes, and a
// non-resolving host would fail that navigation before waitForRequest ever
// sees it.
const REDIRECT_URI = "https://example.com/callback";
const RESOURCE = `${appUrl}/api/mcp`;

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Registers a test MCP client directly in D1, the way an out-of-band CIMD
 * discovery or admin-created client would end up looking — this test is
 * about the consent screen and revoke flow, not client registration. */
async function registerTestClient(page: Page, clientId: string) {
  await rawSql(
    page,
    `insert or ignore into oauth_resource (id, identifier, name, created_at, updated_at)
     values (?, ?, 'rdyrct MCP', 0, 0)`,
    [`resource-${clientId}`, RESOURCE],
  );
  await rawSql(
    page,
    `insert into oauth_client (id, client_id, disabled, redirect_uris,
       token_endpoint_auth_method, grant_types, response_types, created_at, updated_at, name)
     values (?, ?, 0, ?, 'none', '["authorization_code"]', '["code"]', 0, 0, 'Playwright Client')`,
    [`client-row-${clientId}`, clientId, JSON.stringify([REDIRECT_URI])],
  );
  await rawSql(
    page,
    `insert into oauth_client_resource (id, client_id, resource_id, created_at)
     values (?, ?, ?, 0)`,
    [`link-${clientId}`, clientId, RESOURCE],
  );
}

test("connects an MCP client via OAuth consent, then revokes it from Connected apps", async ({
  page,
  request,
}) => {
  await signUpAndVerify(page, `mcp-oauth-${Date.now()}@gmail.com`, E2E_PASSWORD);

  const clientId = `e2e-client-${Date.now()}`;
  await registerTestClient(page, clientId);
  const { verifier, challenge } = pkcePair();

  const authorizeUrl = new URL(`${appUrl}/api/auth/oauth2/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "openid profile email",
    state: "e2e",
  }).toString();

  await page.goto(authorizeUrl.toString());
  await expect(page.getByText("Playwright Client wants access")).toBeVisible();

  // The consent page's own success handler does a real
  // window.location.assign to the client's redirect_uri, leaving this app's
  // origin: wait for that navigation (not its response, which CI's sandbox
  // may not be able to fetch) rather than a raw network-request listener.
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL(`${REDIRECT_URI}*`);
  const code = new URL(page.url()).searchParams.get("code");
  expect(code).toBeTruthy();

  // The `request` fixture, not `page.request`: the page has just navigated
  // to example.com to get here, and page.request ties its behavior to the
  // page's current (now cross-origin) browsing context. This one is its own
  // independent APIRequestContext, the same shape api-keys.pw.ts's `request`
  // calls already use successfully.
  const tokenRes = await request.post(`${appUrl}/api/auth/oauth2/token`, {
    form: {
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    },
  });
  expect(tokenRes.ok()).toBe(true);
  const { access_token } = await tokenRes.json();
  expect(access_token).toBeTruthy();

  const mcpRes = await request.post(`${appUrl}/api/mcp`, {
    headers: {
      authorization: `Bearer ${access_token}`,
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(mcpRes.status()).toBe(200);

  // Connected apps live under the MCP tab, not the default (API keys) one.
  await page.goto(`${appUrl}/api-keys?tab=mcp`);
  await expect(page.getByText("Playwright Client")).toBeVisible();
  await page.getByRole("button", { name: "Revoke Playwright Client" }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  // Back to zero connections: the connect guide, not a bare empty line.
  await expect(page.getByText("Connect an AI assistant", { exact: true })).toBeVisible();

  const revokedMcpRes = await request.post(`${appUrl}/api/mcp`, {
    headers: {
      authorization: `Bearer ${access_token}`,
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  // The live JWT itself is still valid (stateless, see docs.tsx's OAuth
  // section): what revoke actually kills is the ability to mint another one.
  // See tests/worker/mcp-oauth.worker.ts for that half of the contract.
  expect(revokedMcpRes.status()).toBe(200);
});
